from fastapi import FastAPI, APIRouter, Depends, HTTPException, status, WebSocket, WebSocketDisconnect, Query
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from typing import List, Optional
from datetime import datetime, timezone
import asyncio
import json

from models import (
    User, UserCreate, UserLogin, UserInDB, Token, UserRole,
    Hospital, Ambulance, AmbulanceCreate, AmbulanceLocationUpdate, AmbulanceStatus,
    Trip, TripStatus, TrafficEvent, Alert, AlertSend, AssignHospital,
    RouteRequest, RouteResponse, Coordinates, AuditLog
)
from auth import (
    get_password_hash, verify_password, create_access_token,
    get_current_user, require_role, decode_token
)
from routing import compute_route, compute_alternative_routes, rank_hospitals, haversine_distance
from websocket_manager import manager

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI(title="Smart Ambulance Routing System")
api_router = APIRouter(prefix="/api")

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


# ============== AUTH ENDPOINTS ==============
@api_router.post("/auth/register", response_model=Token)
async def register(user_data: UserCreate):
    existing = await db.users.find_one({"email": user_data.email}, {"_id": 0})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    user = User(
        email=user_data.email,
        name=user_data.name,
        role=user_data.role
    )
    user_in_db = UserInDB(
        **user.model_dump(),
        hashed_password=get_password_hash(user_data.password)
    )
    
    doc = user_in_db.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.users.insert_one(doc)
    
    token = create_access_token({"sub": user.id, "email": user.email, "role": user.role.value, "name": user.name})
    return Token(access_token=token, user=user)


@api_router.post("/auth/login", response_model=Token)
async def login(credentials: UserLogin):
    user_doc = await db.users.find_one({"email": credentials.email}, {"_id": 0})
    if not user_doc or not verify_password(credentials.password, user_doc['hashed_password']):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    user = User(
        id=user_doc['id'],
        email=user_doc['email'],
        name=user_doc['name'],
        role=user_doc['role']
    )
    token = create_access_token({"sub": user.id, "email": user.email, "role": user.role, "name": user.name})
    return Token(access_token=token, user=user)


@api_router.get("/auth/me", response_model=User)
async def get_me(current_user: dict = Depends(get_current_user)):
    user_doc = await db.users.find_one({"id": current_user['sub']}, {"_id": 0, "hashed_password": 0})
    if not user_doc:
        raise HTTPException(status_code=404, detail="User not found")
    return User(**user_doc)


# ============== AMBULANCE ENDPOINTS ==============
@api_router.get("/ambulances", response_model=List[Ambulance])
async def get_ambulances(current_user: dict = Depends(get_current_user)):
    ambulances = await db.ambulances.find({}, {"_id": 0}).to_list(100)
    return [Ambulance(**a) for a in ambulances]


@api_router.post("/ambulances", response_model=Ambulance)
async def create_ambulance(
    ambulance_data: AmbulanceCreate,
    current_user: dict = Depends(require_role(["admin", "dispatcher"]))
):
    ambulance = Ambulance(
        call_sign=ambulance_data.call_sign,
        location=ambulance_data.location
    )
    doc = ambulance.model_dump()
    doc['last_updated'] = doc['last_updated'].isoformat()
    doc['location'] = {'lat': doc['location']['lat'], 'lng': doc['location']['lng']}
    await db.ambulances.insert_one(doc)
    
    await log_audit(current_user['sub'], "create_ambulance", f"Created ambulance {ambulance.call_sign}")
    return ambulance


@api_router.post("/ambulance/location")
async def update_ambulance_location(
    update: AmbulanceLocationUpdate,
    current_user: dict = Depends(get_current_user)
):
    result = await db.ambulances.update_one(
        {"id": update.ambulance_id},
        {"$set": {
            "location": {"lat": update.location.lat, "lng": update.location.lng},
            "speed": update.speed,
            "heading": update.heading,
            "last_updated": datetime.now(timezone.utc).isoformat()
        }}
    )
    
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="Ambulance not found")
    
    ambulance = await db.ambulances.find_one({"id": update.ambulance_id}, {"_id": 0})
    await manager.broadcast_ambulance_update(ambulance)
    
    return {"status": "updated"}


@api_router.post("/ambulance/{ambulance_id}/status")
async def update_ambulance_status(
    ambulance_id: str,
    status: AmbulanceStatus,
    current_user: dict = Depends(get_current_user)
):
    result = await db.ambulances.update_one(
        {"id": ambulance_id},
        {"$set": {"status": status.value, "last_updated": datetime.now(timezone.utc).isoformat()}}
    )
    
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="Ambulance not found")
    
    ambulance = await db.ambulances.find_one({"id": ambulance_id}, {"_id": 0})
    await manager.broadcast_ambulance_update(ambulance)
    await log_audit(current_user['sub'], "update_status", f"Ambulance {ambulance_id} status changed to {status.value}")
    
    return {"status": "updated"}


@api_router.post("/ambulance/{ambulance_id}/assign-driver")
async def assign_driver_to_ambulance(
    ambulance_id: str,
    current_user: dict = Depends(require_role(["driver"]))
):
    result = await db.ambulances.update_one(
        {"id": ambulance_id},
        {"$set": {
            "driver_id": current_user['sub'],
            "driver_name": current_user['name'],
            "last_updated": datetime.now(timezone.utc).isoformat()
        }}
    )
    
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="Ambulance not found")
    
    return {"status": "assigned"}


# ============== HOSPITAL ENDPOINTS ==============
@api_router.get("/hospitals", response_model=List[Hospital])
async def get_hospitals(current_user: dict = Depends(get_current_user)):
    hospitals = await db.hospitals.find({}, {"_id": 0}).to_list(100)
    return [Hospital(**h) for h in hospitals]


@api_router.get("/hospitals/nearby")
async def get_nearby_hospitals(
    lat: float = Query(...),
    lng: float = Query(...),
    specialty: Optional[str] = Query(None),
    current_user: dict = Depends(get_current_user)
):
    hospitals = await db.hospitals.find({}, {"_id": 0}).to_list(100)
    ambulance_location = Coordinates(lat=lat, lng=lng)
    ranked = rank_hospitals(ambulance_location, hospitals, specialty)
    return ranked[:10]


@api_router.post("/hospitals", response_model=Hospital)
async def create_hospital(
    hospital: Hospital,
    current_user: dict = Depends(require_role(["admin"]))
):
    doc = hospital.model_dump()
    doc['coordinates'] = {'lat': doc['coordinates']['lat'], 'lng': doc['coordinates']['lng']}
    await db.hospitals.insert_one(doc)
    return hospital


# ============== ROUTING ENDPOINTS ==============
@api_router.post("/route/request", response_model=RouteResponse)
async def request_route(
    request: RouteRequest,
    current_user: dict = Depends(get_current_user)
):
    ambulance = await db.ambulances.find_one({"id": request.ambulance_id}, {"_id": 0})
    if not ambulance:
        raise HTTPException(status_code=404, detail="Ambulance not found")
    
    start = Coordinates(lat=ambulance['location']['lat'], lng=ambulance['location']['lng'])
    traffic_level = await get_traffic_level(start)
    
    primary_route = compute_route(start, request.destination, traffic_level, request.emergency)
    backup_routes = compute_alternative_routes(start, request.destination, traffic_level)
    
    # Find best hospital near destination
    hospitals = await db.hospitals.find({}, {"_id": 0}).to_list(100)
    ranked = rank_hospitals(request.destination, hospitals)
    recommended_hospital_id = ranked[0]['id'] if ranked else None
    
    return RouteResponse(
        primary_route=primary_route,
        backup_routes=backup_routes,
        recommended_hospital_id=recommended_hospital_id
    )


# ============== TRIP ENDPOINTS ==============
@api_router.get("/trips", response_model=List[Trip])
async def get_trips(
    status: Optional[TripStatus] = None,
    current_user: dict = Depends(get_current_user)
):
    query = {}
    if status:
        query['status'] = status.value
    if current_user['role'] == 'driver':
        query['driver_id'] = current_user['sub']
    
    trips = await db.trips.find(query, {"_id": 0}).to_list(100)
    return trips


@api_router.post("/trips", response_model=Trip)
async def create_trip(
    ambulance_id: str,
    hospital_id: str,
    current_user: dict = Depends(get_current_user)
):
    ambulance = await db.ambulances.find_one({"id": ambulance_id}, {"_id": 0})
    hospital = await db.hospitals.find_one({"id": hospital_id}, {"_id": 0})
    
    if not ambulance or not hospital:
        raise HTTPException(status_code=404, detail="Ambulance or hospital not found")
    
    start_location = Coordinates(lat=ambulance['location']['lat'], lng=ambulance['location']['lng'])
    end_location = Coordinates(lat=hospital['coordinates']['lat'], lng=hospital['coordinates']['lng'])
    route = compute_route(start_location, end_location)
    
    trip = Trip(
        ambulance_id=ambulance_id,
        driver_id=ambulance.get('driver_id'),
        start_location=start_location,
        end_location=end_location,
        assigned_hospital_id=hospital_id,
        route=route,
        status=TripStatus.IN_PROGRESS
    )
    
    doc = trip.model_dump()
    doc['started_at'] = doc['started_at'].isoformat()
    await db.trips.insert_one(doc)
    
    # Update ambulance status
    await db.ambulances.update_one(
        {"id": ambulance_id},
        {"$set": {
            "status": AmbulanceStatus.ON_ROUTE.value,
            "assigned_hospital_id": hospital_id,
            "current_trip_id": trip.id
        }}
    )
    
    await log_audit(current_user['sub'], "create_trip", f"Trip {trip.id} created for ambulance {ambulance_id}")
    return trip


@api_router.post("/trips/{trip_id}/complete")
async def complete_trip(trip_id: str, current_user: dict = Depends(get_current_user)):
    trip = await db.trips.find_one({"id": trip_id}, {"_id": 0})
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")
    
    await db.trips.update_one(
        {"id": trip_id},
        {"$set": {"status": TripStatus.COMPLETED.value, "completed_at": datetime.now(timezone.utc).isoformat()}}
    )
    
    await db.ambulances.update_one(
        {"id": trip['ambulance_id']},
        {"$set": {
            "status": AmbulanceStatus.AVAILABLE.value,
            "assigned_hospital_id": None,
            "current_trip_id": None
        }}
    )
    
    return {"status": "completed"}


# ============== ALERT ENDPOINTS ==============
@api_router.post("/alerts/send", response_model=Alert)
async def send_alert(
    alert_data: AlertSend,
    current_user: dict = Depends(get_current_user)
):
    ambulance = await db.ambulances.find_one({"id": alert_data.ambulance_id}, {"_id": 0})
    if not ambulance:
        raise HTTPException(status_code=404, detail="Ambulance not found")
    
    alert = Alert(
        ambulance_id=alert_data.ambulance_id,
        message=f"Emergency ambulance {ambulance['call_sign']} approaching. Please give way!",
        location=alert_data.location,
        radius_km=alert_data.radius_km
    )
    
    doc = alert.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    doc['location'] = {'lat': doc['location']['lat'], 'lng': doc['location']['lng']}
    await db.alerts.insert_one(doc)
    
    await manager.broadcast_alert({
        "ambulance_id": alert.ambulance_id,
        "call_sign": ambulance['call_sign'],
        "message": alert.message,
        "location": {"lat": alert.location.lat, "lng": alert.location.lng}
    })
    
    return alert


@api_router.get("/alerts", response_model=List[Alert])
async def get_alerts(current_user: dict = Depends(get_current_user)):
    alerts = await db.alerts.find({}, {"_id": 0}).sort("created_at", -1).to_list(50)
    return alerts


# ============== TRAFFIC ENDPOINTS ==============
@api_router.get("/traffic/events", response_model=List[TrafficEvent])
async def get_traffic_events(current_user: dict = Depends(get_current_user)):
    events = await db.traffic_events.find({"resolved": False}, {"_id": 0}).to_list(100)
    return events


@api_router.post("/traffic/events", response_model=TrafficEvent)
async def create_traffic_event(
    event: TrafficEvent,
    current_user: dict = Depends(require_role(["admin", "dispatcher"]))
):
    doc = event.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    doc['location'] = {'lat': doc['location']['lat'], 'lng': doc['location']['lng']}
    await db.traffic_events.insert_one(doc)
    return event


# ============== ASSIGN HOSPITAL ==============
@api_router.post("/assign-hospital")
async def assign_hospital(
    assignment: AssignHospital,
    current_user: dict = Depends(require_role(["admin", "dispatcher"]))
):
    ambulance = await db.ambulances.find_one({"id": assignment.ambulance_id}, {"_id": 0})
    hospital = await db.hospitals.find_one({"id": assignment.hospital_id}, {"_id": 0})
    
    if not ambulance or not hospital:
        raise HTTPException(status_code=404, detail="Ambulance or hospital not found")
    
    await db.ambulances.update_one(
        {"id": assignment.ambulance_id},
        {"$set": {"assigned_hospital_id": assignment.hospital_id}}
    )
    
    # Send route to driver
    start = Coordinates(lat=ambulance['location']['lat'], lng=ambulance['location']['lng'])
    end = Coordinates(lat=hospital['coordinates']['lat'], lng=hospital['coordinates']['lng'])
    route = compute_route(start, end)
    
    if ambulance.get('driver_id'):
        await manager.send_route_update(ambulance['driver_id'], {
            "hospital": hospital,
            "route": route.model_dump()
        })
    
    await log_audit(current_user['sub'], "assign_hospital", f"Assigned ambulance {assignment.ambulance_id} to hospital {assignment.hospital_id}")
    
    return {"status": "assigned", "route": route.model_dump()}


# ============== ADMIN ENDPOINTS ==============
@api_router.get("/admin/users", response_model=List[User])
async def get_users(current_user: dict = Depends(require_role(["admin"]))):
    users = await db.users.find({}, {"_id": 0, "hashed_password": 0}).to_list(100)
    return [User(**u) for u in users]


@api_router.get("/admin/audit-logs", response_model=List[AuditLog])
async def get_audit_logs(current_user: dict = Depends(require_role(["admin"]))):
    logs = await db.audit_logs.find({}, {"_id": 0}).sort("timestamp", -1).to_list(100)
    return logs


@api_router.delete("/admin/users/{user_id}")
async def delete_user(user_id: str, current_user: dict = Depends(require_role(["admin"]))):
    result = await db.users.delete_one({"id": user_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    await log_audit(current_user['sub'], "delete_user", f"Deleted user {user_id}")
    return {"status": "deleted"}


# ============== SIMULATION ENDPOINTS ==============
@api_router.post("/simulation/seed")
async def seed_simulation_data(current_user: dict = Depends(require_role(["admin"]))):
    """Seed the database with sample data for simulation."""
    
    # Sample hospitals
    hospitals = [
        Hospital(name="City General Hospital", coordinates=Coordinates(lat=40.7128, lng=-74.0060), 
                 phone="555-0100", specialties=["trauma", "cardiac", "general"], availability=15,
                 address="123 Main St, New York"),
        Hospital(name="St. Mary's Medical Center", coordinates=Coordinates(lat=40.7200, lng=-74.0100),
                 phone="555-0101", specialties=["pediatric", "general"], availability=8,
                 address="456 Oak Ave, New York"),
        Hospital(name="Metro Heart Institute", coordinates=Coordinates(lat=40.7050, lng=-73.9900),
                 phone="555-0102", specialties=["cardiac", "stroke"], availability=12,
                 address="789 Heart Blvd, New York"),
        Hospital(name="Children's Healthcare Center", coordinates=Coordinates(lat=40.7300, lng=-74.0200),
                 phone="555-0103", specialties=["pediatric", "neonatal"], availability=20,
                 address="321 Kids Way, New York"),
        Hospital(name="Trauma Level 1 Center", coordinates=Coordinates(lat=40.7180, lng=-73.9950),
                 phone="555-0104", specialties=["trauma", "burns", "surgery"], availability=6,
                 address="555 Emergency Dr, New York"),
    ]
    
    for h in hospitals:
        existing = await db.hospitals.find_one({"name": h.name})
        if not existing:
            doc = h.model_dump()
            doc['coordinates'] = {'lat': doc['coordinates']['lat'], 'lng': doc['coordinates']['lng']}
            await db.hospitals.insert_one(doc)
    
    # Sample ambulances
    ambulances = [
        Ambulance(call_sign="AMB-001", location=Coordinates(lat=40.7150, lng=-74.0050), status=AmbulanceStatus.AVAILABLE),
        Ambulance(call_sign="AMB-002", location=Coordinates(lat=40.7220, lng=-74.0120), status=AmbulanceStatus.AVAILABLE),
        Ambulance(call_sign="AMB-003", location=Coordinates(lat=40.7080, lng=-73.9980), status=AmbulanceStatus.ON_ROUTE),
        Ambulance(call_sign="AMB-004", location=Coordinates(lat=40.7280, lng=-74.0080), status=AmbulanceStatus.EMERGENCY),
        Ambulance(call_sign="AMB-005", location=Coordinates(lat=40.7100, lng=-74.0020), status=AmbulanceStatus.AVAILABLE),
    ]
    
    for a in ambulances:
        existing = await db.ambulances.find_one({"call_sign": a.call_sign})
        if not existing:
            doc = a.model_dump()
            doc['last_updated'] = doc['last_updated'].isoformat()
            doc['location'] = {'lat': doc['location']['lat'], 'lng': doc['location']['lng']}
            await db.ambulances.insert_one(doc)
    
    # Sample traffic events
    traffic_events = [
        TrafficEvent(event_type="accident", location=Coordinates(lat=40.7160, lng=-74.0070), 
                     severity=3, description="Multi-vehicle collision on Main St"),
        TrafficEvent(event_type="congestion", location=Coordinates(lat=40.7190, lng=-74.0040),
                     severity=2, description="Heavy traffic near downtown"),
    ]
    
    for te in traffic_events:
        doc = te.model_dump()
        doc['created_at'] = doc['created_at'].isoformat()
        doc['location'] = {'lat': doc['location']['lat'], 'lng': doc['location']['lng']}
        await db.traffic_events.insert_one(doc)
    
    return {"status": "seeded", "hospitals": len(hospitals), "ambulances": len(ambulances)}


@api_router.post("/simulation/move-ambulance")
async def simulate_ambulance_movement(
    ambulance_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Simulate ambulance movement along its route."""
    ambulance = await db.ambulances.find_one({"id": ambulance_id}, {"_id": 0})
    if not ambulance:
        raise HTTPException(status_code=404, detail="Ambulance not found")
    
    # Simulate small movement
    import random
    new_lat = ambulance['location']['lat'] + random.uniform(-0.001, 0.001)
    new_lng = ambulance['location']['lng'] + random.uniform(-0.001, 0.001)
    
    await db.ambulances.update_one(
        {"id": ambulance_id},
        {"$set": {
            "location": {"lat": new_lat, "lng": new_lng},
            "speed": random.uniform(30, 80),
            "last_updated": datetime.now(timezone.utc).isoformat()
        }}
    )
    
    updated = await db.ambulances.find_one({"id": ambulance_id}, {"_id": 0})
    await manager.broadcast_ambulance_update(updated)
    
    return {"status": "moved", "new_location": {"lat": new_lat, "lng": new_lng}}


# ============== WEBSOCKET ENDPOINTS ==============
@app.websocket("/api/ws/dispatcher")
async def websocket_dispatcher(websocket: WebSocket):
    await manager.connect_dispatcher(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            # Handle dispatcher messages
            if message.get('type') == 'ping':
                await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        manager.disconnect_dispatcher(websocket)


@app.websocket("/api/ws/driver/{driver_id}")
async def websocket_driver(websocket: WebSocket, driver_id: str):
    await manager.connect_driver(websocket, driver_id)
    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            
            if message.get('type') == 'location_update':
                # Process location update
                loc_data = message.get('data', {})
                if loc_data.get('ambulance_id'):
                    await db.ambulances.update_one(
                        {"id": loc_data['ambulance_id']},
                        {"$set": {
                            "location": {"lat": loc_data['lat'], "lng": loc_data['lng']},
                            "speed": loc_data.get('speed', 0),
                            "last_updated": datetime.now(timezone.utc).isoformat()
                        }}
                    )
                    ambulance = await db.ambulances.find_one({"id": loc_data['ambulance_id']}, {"_id": 0})
                    await manager.broadcast_ambulance_update(ambulance)
            elif message.get('type') == 'ping':
                await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        manager.disconnect_driver(driver_id)


# ============== HELPER FUNCTIONS ==============
async def get_traffic_level(location: Coordinates) -> int:
    """Get traffic level (1-5) near a location."""
    events = await db.traffic_events.find({"resolved": False}, {"_id": 0}).to_list(100)
    
    max_severity = 1
    for event in events:
        event_loc = Coordinates(lat=event['location']['lat'], lng=event['location']['lng'])
        distance = haversine_distance(location, event_loc)
        if distance < 2:  # Within 2km
            max_severity = max(max_severity, event.get('severity', 1))
    
    return max_severity


async def log_audit(user_id: str, action: str, details: str):
    """Log an audit entry."""
    log = AuditLog(user_id=user_id, action=action, details=details)
    doc = log.model_dump()
    doc['timestamp'] = doc['timestamp'].isoformat()
    await db.audit_logs.insert_one(doc)


# ============== ROOT & HEALTH ==============
@api_router.get("/")
async def root():
    return {"message": "Smart Ambulance Routing System API", "version": "1.0.0"}


@api_router.get("/health")
async def health():
    return {"status": "healthy"}


# Include router and middleware
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
