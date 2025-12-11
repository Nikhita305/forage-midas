from fastapi import FastAPI, APIRouter, Depends, HTTPException, status, WebSocket, WebSocketDisconnect, Query
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from typing import List, Optional
from datetime import datetime, timezone
import json

from models import (
    User, UserCreate, UserLogin, UserInDB, Token, UserRole,
    Hospital, Ambulance, AmbulanceCreate, AmbulanceLocationUpdate, AmbulanceStatus,
    Trip, TripStatus, TrafficEvent, Alert, AlertSend,
    RouteRequest, RouteResponse, Coordinates, StartTripRequest, EndTripRequest, GPSPoint
)
from auth import (
    get_password_hash, verify_password, create_access_token,
    get_current_user, require_role
)
from routing import compute_route, compute_backup_route, rank_hospitals_by_eta, haversine_distance
from websocket_manager import manager

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI(title="Smart Ambulance Routing System")
api_router = APIRouter(prefix="/api")

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


@api_router.get("/ambulances/available", response_model=List[Ambulance])
async def get_available_ambulances(current_user: dict = Depends(get_current_user)):
    """Get ambulances available for assignment."""
    ambulances = await db.ambulances.find(
        {"$or": [{"driver_id": None}, {"driver_id": ""}], "status": "available"}, 
        {"_id": 0}
    ).to_list(100)
    return [Ambulance(**a) for a in ambulances]


@api_router.get("/ambulances/my", response_model=Optional[Ambulance])
async def get_my_ambulance(current_user: dict = Depends(get_current_user)):
    """Get the ambulance assigned to current driver."""
    ambulance = await db.ambulances.find_one({"driver_id": current_user['sub']}, {"_id": 0})
    if ambulance:
        return Ambulance(**ambulance)
    return None


@api_router.post("/ambulances", response_model=Ambulance)
async def create_ambulance(
    ambulance_data: AmbulanceCreate,
    current_user: dict = Depends(require_role(["admin"]))
):
    ambulance = Ambulance(
        call_sign=ambulance_data.call_sign,
        location=ambulance_data.location
    )
    doc = ambulance.model_dump()
    doc['last_updated'] = doc['last_updated'].isoformat()
    doc['location'] = {'lat': doc['location']['lat'], 'lng': doc['location']['lng']}
    await db.ambulances.insert_one(doc)
    return ambulance


@api_router.post("/ambulance/location")
async def update_ambulance_location(
    update: AmbulanceLocationUpdate,
    current_user: dict = Depends(get_current_user)
):
    """Update ambulance GPS location - called frequently during trips."""
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
    
    # Also update trip GPS history if there's an active trip
    ambulance = await db.ambulances.find_one({"id": update.ambulance_id}, {"_id": 0})
    if ambulance and ambulance.get('current_trip_id'):
        gps_point = {
            "lat": update.location.lat,
            "lng": update.location.lng,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "speed": update.speed
        }
        await db.trips.update_one(
            {"id": ambulance['current_trip_id']},
            {"$push": {"gps_history": gps_point}}
        )
    
    return {"status": "updated", "location": {"lat": update.location.lat, "lng": update.location.lng}}


@api_router.post("/ambulance/{ambulance_id}/claim")
async def claim_ambulance(ambulance_id: str, current_user: dict = Depends(get_current_user)):
    """Driver claims/assigns themselves to an ambulance."""
    # Check if ambulance exists and is available
    ambulance = await db.ambulances.find_one({"id": ambulance_id}, {"_id": 0})
    if not ambulance:
        raise HTTPException(status_code=404, detail="Ambulance not found")
    
    if ambulance.get('driver_id') and ambulance['driver_id'] != current_user['sub']:
        raise HTTPException(status_code=400, detail="Ambulance already assigned to another driver")
    
    # Check if driver already has an ambulance
    existing = await db.ambulances.find_one({"driver_id": current_user['sub']}, {"_id": 0})
    if existing and existing['id'] != ambulance_id:
        raise HTTPException(status_code=400, detail="You already have an ambulance assigned")
    
    await db.ambulances.update_one(
        {"id": ambulance_id},
        {"$set": {
            "driver_id": current_user['sub'],
            "driver_name": current_user['name'],
            "status": "available",
            "last_updated": datetime.now(timezone.utc).isoformat()
        }}
    )
    
    return {"status": "claimed", "ambulance_id": ambulance_id}


@api_router.post("/ambulance/{ambulance_id}/release")
async def release_ambulance(ambulance_id: str, current_user: dict = Depends(get_current_user)):
    """Driver releases their ambulance."""
    ambulance = await db.ambulances.find_one({"id": ambulance_id}, {"_id": 0})
    if not ambulance:
        raise HTTPException(status_code=404, detail="Ambulance not found")
    
    if ambulance.get('driver_id') != current_user['sub']:
        raise HTTPException(status_code=403, detail="Not your ambulance")
    
    if ambulance.get('current_trip_id'):
        raise HTTPException(status_code=400, detail="Cannot release ambulance during active trip")
    
    await db.ambulances.update_one(
        {"id": ambulance_id},
        {"$set": {
            "driver_id": None,
            "driver_name": None,
            "status": "available",
            "last_updated": datetime.now(timezone.utc).isoformat()
        }}
    )
    
    return {"status": "released"}


@api_router.post("/ambulance/{ambulance_id}/emergency")
async def toggle_emergency_mode(
    ambulance_id: str,
    enable: bool = True,
    current_user: dict = Depends(get_current_user)
):
    """Toggle emergency mode for ambulance."""
    ambulance = await db.ambulances.find_one({"id": ambulance_id}, {"_id": 0})
    if not ambulance:
        raise HTTPException(status_code=404, detail="Ambulance not found")
    
    if ambulance.get('driver_id') != current_user['sub']:
        raise HTTPException(status_code=403, detail="Not your ambulance")
    
    new_status = AmbulanceStatus.EMERGENCY if enable else AmbulanceStatus.AVAILABLE
    if ambulance.get('current_trip_id'):
        new_status = AmbulanceStatus.EMERGENCY if enable else AmbulanceStatus.ON_TRIP
    
    await db.ambulances.update_one(
        {"id": ambulance_id},
        {"$set": {"status": new_status.value, "last_updated": datetime.now(timezone.utc).isoformat()}}
    )
    
    # Send traffic clearing alert if emergency enabled
    if enable:
        alert = Alert(
            ambulance_id=ambulance_id,
            ambulance_call_sign=ambulance['call_sign'],
            message=f"🚨 Emergency ambulance {ambulance['call_sign']} approaching — please give way!",
            location=Coordinates(**ambulance['location']),
            radius_km=1.5
        )
        doc = alert.model_dump()
        doc['created_at'] = doc['created_at'].isoformat()
        doc['location'] = {'lat': doc['location']['lat'], 'lng': doc['location']['lng']}
        await db.alerts.insert_one(doc)
        
        # Broadcast to civilian apps
        await manager.broadcast_traffic_alert({
            "ambulance_call_sign": ambulance['call_sign'],
            "message": alert.message,
            "location": {"lat": ambulance['location']['lat'], "lng": ambulance['location']['lng']},
            "type": "emergency"
        })
    
    return {"status": "emergency_enabled" if enable else "emergency_disabled"}


# ============== HOSPITAL ENDPOINTS ==============
@api_router.get("/hospitals", response_model=List[Hospital])
async def get_hospitals(current_user: dict = Depends(get_current_user)):
    hospitals = await db.hospitals.find({}, {"_id": 0}).to_list(100)
    return [Hospital(**h) for h in hospitals]


@api_router.get("/hospitals/nearby")
async def get_nearby_hospitals(
    lat: float = Query(...),
    lng: float = Query(...),
    current_user: dict = Depends(get_current_user)
):
    """Get hospitals ranked by ETA from current location."""
    hospitals = await db.hospitals.find({}, {"_id": 0}).to_list(100)
    traffic_level = await get_traffic_level(Coordinates(lat=lat, lng=lng))
    ranked = rank_hospitals_by_eta(Coordinates(lat=lat, lng=lng), hospitals, traffic_level)
    return ranked[:10]


@api_router.get("/hospitals/{hospital_id}", response_model=Hospital)
async def get_hospital(hospital_id: str, current_user: dict = Depends(get_current_user)):
    hospital = await db.hospitals.find_one({"id": hospital_id}, {"_id": 0})
    if not hospital:
        raise HTTPException(status_code=404, detail="Hospital not found")
    return Hospital(**hospital)


# ============== ROUTING ENDPOINTS ==============
@api_router.post("/route/calculate", response_model=RouteResponse)
async def calculate_route(
    request: RouteRequest,
    current_user: dict = Depends(get_current_user)
):
    """Calculate route from ambulance to destination."""
    ambulance = await db.ambulances.find_one({"id": request.ambulance_id}, {"_id": 0})
    if not ambulance:
        raise HTTPException(status_code=404, detail="Ambulance not found")
    
    start = Coordinates(lat=ambulance['location']['lat'], lng=ambulance['location']['lng'])
    traffic_level = await get_traffic_level(start)
    
    primary_route = compute_route(start, request.destination, traffic_level, request.emergency)
    backup_route = compute_backup_route(start, request.destination, traffic_level)
    
    return RouteResponse(
        primary_route=primary_route,
        backup_route=backup_route
    )


@api_router.post("/route/to-hospital/{hospital_id}", response_model=RouteResponse)
async def calculate_route_to_hospital(
    hospital_id: str,
    ambulance_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Calculate route from ambulance to specific hospital."""
    ambulance = await db.ambulances.find_one({"id": ambulance_id}, {"_id": 0})
    hospital = await db.hospitals.find_one({"id": hospital_id}, {"_id": 0})
    
    if not ambulance:
        raise HTTPException(status_code=404, detail="Ambulance not found")
    if not hospital:
        raise HTTPException(status_code=404, detail="Hospital not found")
    
    start = Coordinates(lat=ambulance['location']['lat'], lng=ambulance['location']['lng'])
    end = Coordinates(lat=hospital['coordinates']['lat'], lng=hospital['coordinates']['lng'])
    traffic_level = await get_traffic_level(start)
    
    primary_route = compute_route(start, end, traffic_level, True)
    backup_route = compute_backup_route(start, end, traffic_level)
    
    return RouteResponse(
        primary_route=primary_route,
        backup_route=backup_route,
        destination_hospital=Hospital(**hospital)
    )


# ============== TRIP ENDPOINTS ==============
@api_router.post("/trip/start", response_model=Trip)
async def start_trip(
    request: StartTripRequest,
    current_user: dict = Depends(get_current_user)
):
    """Start a new trip to hospital."""
    ambulance = await db.ambulances.find_one({"id": request.ambulance_id}, {"_id": 0})
    hospital = await db.hospitals.find_one({"id": request.hospital_id}, {"_id": 0})
    
    if not ambulance:
        raise HTTPException(status_code=404, detail="Ambulance not found")
    if not hospital:
        raise HTTPException(status_code=404, detail="Hospital not found")
    
    if ambulance.get('driver_id') != current_user['sub']:
        raise HTTPException(status_code=403, detail="Not your ambulance")
    
    if ambulance.get('current_trip_id'):
        raise HTTPException(status_code=400, detail="Already on a trip")
    
    # Calculate route
    start_loc = Coordinates(lat=ambulance['location']['lat'], lng=ambulance['location']['lng'])
    end_loc = Coordinates(lat=hospital['coordinates']['lat'], lng=hospital['coordinates']['lng'])
    traffic_level = await get_traffic_level(start_loc)
    route = compute_route(start_loc, end_loc, traffic_level, True)
    
    trip = Trip(
        ambulance_id=request.ambulance_id,
        driver_id=current_user['sub'],
        driver_name=current_user['name'],
        destination_hospital_id=request.hospital_id,
        destination_hospital_name=hospital['name'],
        start_location=start_loc,
        end_location=end_loc,
        route=route,
        traffic_conditions="heavy" if traffic_level >= 3 else "moderate" if traffic_level >= 2 else "normal"
    )
    
    doc = trip.model_dump()
    doc['started_at'] = doc['started_at'].isoformat()
    doc['route']['points'] = [p.model_dump() if hasattr(p, 'model_dump') else p for p in doc['route']['points']]
    await db.trips.insert_one(doc)
    
    # Update ambulance status
    await db.ambulances.update_one(
        {"id": request.ambulance_id},
        {"$set": {
            "status": AmbulanceStatus.ON_TRIP.value,
            "current_trip_id": trip.id,
            "last_updated": datetime.now(timezone.utc).isoformat()
        }}
    )
    
    return trip


@api_router.post("/trip/end")
async def end_trip(
    request: EndTripRequest,
    current_user: dict = Depends(get_current_user)
):
    """End current trip."""
    trip = await db.trips.find_one({"id": request.trip_id}, {"_id": 0})
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")
    
    if trip['driver_id'] != current_user['sub']:
        raise HTTPException(status_code=403, detail="Not your trip")
    
    if trip['status'] != 'active':
        raise HTTPException(status_code=400, detail="Trip already ended")
    
    # Update trip
    await db.trips.update_one(
        {"id": request.trip_id},
        {"$set": {
            "status": TripStatus.COMPLETED.value,
            "completed_at": datetime.now(timezone.utc).isoformat()
        }}
    )
    
    # Update ambulance
    await db.ambulances.update_one(
        {"id": trip['ambulance_id']},
        {"$set": {
            "status": AmbulanceStatus.AVAILABLE.value,
            "current_trip_id": None,
            "last_updated": datetime.now(timezone.utc).isoformat()
        }}
    )
    
    return {"status": "completed", "trip_id": request.trip_id}


@api_router.get("/trip/current", response_model=Optional[Trip])
async def get_current_trip(current_user: dict = Depends(get_current_user)):
    """Get driver's current active trip."""
    trip = await db.trips.find_one(
        {"driver_id": current_user['sub'], "status": "active"},
        {"_id": 0}
    )
    if trip:
        return Trip(**trip)
    return None


@api_router.get("/trips/history", response_model=List[Trip])
async def get_trip_history(
    limit: int = 20,
    current_user: dict = Depends(get_current_user)
):
    """Get driver's trip history."""
    trips = await db.trips.find(
        {"driver_id": current_user['sub']},
        {"_id": 0}
    ).sort("started_at", -1).limit(limit).to_list(limit)
    return [Trip(**t) for t in trips]


# ============== TRAFFIC & ALERTS ==============
@api_router.get("/traffic/events", response_model=List[TrafficEvent])
async def get_traffic_events(current_user: dict = Depends(get_current_user)):
    events = await db.traffic_events.find({"resolved": False}, {"_id": 0}).to_list(100)
    return events


@api_router.post("/alerts/send", response_model=Alert)
async def send_traffic_clearing_alert(
    alert_data: AlertSend,
    current_user: dict = Depends(get_current_user)
):
    """Send traffic clearing alert to civilian apps."""
    ambulance = await db.ambulances.find_one({"id": alert_data.ambulance_id}, {"_id": 0})
    if not ambulance:
        raise HTTPException(status_code=404, detail="Ambulance not found")
    
    alert = Alert(
        ambulance_id=alert_data.ambulance_id,
        ambulance_call_sign=ambulance['call_sign'],
        message=f"🚨 Ambulance {ambulance['call_sign']} approaching — please give way!",
        location=alert_data.location,
        radius_km=alert_data.radius_km
    )
    
    doc = alert.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    doc['location'] = {'lat': doc['location']['lat'], 'lng': doc['location']['lng']}
    await db.alerts.insert_one(doc)
    
    # Broadcast to civilian apps
    await manager.broadcast_traffic_alert({
        "ambulance_call_sign": ambulance['call_sign'],
        "message": alert.message,
        "location": {"lat": alert.location.lat, "lng": alert.location.lng}
    })
    
    return alert


# ============== V2X API (Future Traffic Signal Preemption) ==============
@api_router.post("/v2x/signal-preemption")
async def request_signal_preemption(
    ambulance_id: str,
    intersection_lat: float,
    intersection_lng: float,
    current_user: dict = Depends(get_current_user)
):
    """
    API endpoint for future V2X traffic signal preemption integration.
    When connected to traffic management systems, this will request
    green lights for approaching emergency vehicles.
    """
    ambulance = await db.ambulances.find_one({"id": ambulance_id}, {"_id": 0})
    if not ambulance:
        raise HTTPException(status_code=404, detail="Ambulance not found")
    
    # Log the preemption request (actual integration would send to traffic system)
    preemption_request = {
        "ambulance_id": ambulance_id,
        "ambulance_call_sign": ambulance['call_sign'],
        "intersection": {"lat": intersection_lat, "lng": intersection_lng},
        "ambulance_location": ambulance['location'],
        "status": ambulance['status'],
        "requested_at": datetime.now(timezone.utc).isoformat(),
        "response": "SIMULATED_GREEN_LIGHT"  # In real system, this would come from traffic controller
    }
    
    await db.v2x_requests.insert_one(preemption_request)
    
    return {
        "status": "preemption_requested",
        "message": "Signal preemption request logged (V2X integration pending)",
        "intersection": {"lat": intersection_lat, "lng": intersection_lng}
    }


# ============== ADMIN ENDPOINTS ==============
@api_router.get("/admin/users", response_model=List[User])
async def get_users(current_user: dict = Depends(require_role(["admin"]))):
    users = await db.users.find({}, {"_id": 0, "hashed_password": 0}).to_list(100)
    return [User(**u) for u in users]


@api_router.get("/admin/trips", response_model=List[Trip])
async def get_all_trips(
    limit: int = 50,
    current_user: dict = Depends(require_role(["admin"]))
):
    """Admin view of all trips."""
    trips = await db.trips.find({}, {"_id": 0}).sort("started_at", -1).limit(limit).to_list(limit)
    return trips


@api_router.delete("/admin/users/{user_id}")
async def delete_user(user_id: str, current_user: dict = Depends(require_role(["admin"]))):
    result = await db.users.delete_one({"id": user_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    return {"status": "deleted"}


@api_router.post("/admin/seed-data")
async def seed_data(current_user: dict = Depends(require_role(["admin"]))):
    """Seed sample hospitals and ambulances."""
    
    hospitals = [
        Hospital(name="City General Hospital", coordinates=Coordinates(lat=40.7128, lng=-74.0060), 
                 phone="555-0100", specialties=["trauma", "cardiac", "general"],
                 address="123 Main St, New York"),
        Hospital(name="St. Mary's Medical Center", coordinates=Coordinates(lat=40.7200, lng=-74.0100),
                 phone="555-0101", specialties=["pediatric", "general"],
                 address="456 Oak Ave, New York"),
        Hospital(name="Metro Heart Institute", coordinates=Coordinates(lat=40.7050, lng=-73.9900),
                 phone="555-0102", specialties=["cardiac", "stroke"],
                 address="789 Heart Blvd, New York"),
        Hospital(name="Children's Healthcare Center", coordinates=Coordinates(lat=40.7300, lng=-74.0200),
                 phone="555-0103", specialties=["pediatric", "neonatal"],
                 address="321 Kids Way, New York"),
        Hospital(name="Trauma Level 1 Center", coordinates=Coordinates(lat=40.7180, lng=-73.9950),
                 phone="555-0104", specialties=["trauma", "burns", "surgery"],
                 address="555 Emergency Dr, New York"),
    ]
    
    for h in hospitals:
        existing = await db.hospitals.find_one({"name": h.name})
        if not existing:
            doc = h.model_dump()
            doc['coordinates'] = {'lat': doc['coordinates']['lat'], 'lng': doc['coordinates']['lng']}
            await db.hospitals.insert_one(doc)
    
    ambulances = [
        Ambulance(call_sign="AMB-001", location=Coordinates(lat=40.7150, lng=-74.0050)),
        Ambulance(call_sign="AMB-002", location=Coordinates(lat=40.7220, lng=-74.0120)),
        Ambulance(call_sign="AMB-003", location=Coordinates(lat=40.7080, lng=-73.9980)),
        Ambulance(call_sign="AMB-004", location=Coordinates(lat=40.7280, lng=-74.0080)),
        Ambulance(call_sign="AMB-005", location=Coordinates(lat=40.7100, lng=-74.0020)),
    ]
    
    for a in ambulances:
        existing = await db.ambulances.find_one({"call_sign": a.call_sign})
        if not existing:
            doc = a.model_dump()
            doc['last_updated'] = doc['last_updated'].isoformat()
            doc['location'] = {'lat': doc['location']['lat'], 'lng': doc['location']['lng']}
            await db.ambulances.insert_one(doc)
    
    # Add some traffic events
    traffic_events = [
        TrafficEvent(event_type="congestion", location=Coordinates(lat=40.7160, lng=-74.0070), 
                     severity=2, description="Moderate traffic near downtown"),
        TrafficEvent(event_type="accident", location=Coordinates(lat=40.7190, lng=-74.0040),
                     severity=4, description="Multi-vehicle accident on Main St"),
    ]
    
    for te in traffic_events:
        doc = te.model_dump()
        doc['created_at'] = doc['created_at'].isoformat()
        doc['location'] = {'lat': doc['location']['lat'], 'lng': doc['location']['lng']}
        await db.traffic_events.insert_one(doc)
    
    return {"status": "seeded", "hospitals": len(hospitals), "ambulances": len(ambulances)}


# ============== WEBSOCKET ENDPOINTS ==============
@app.websocket("/api/ws/driver/{driver_id}")
async def websocket_driver(websocket: WebSocket, driver_id: str):
    """WebSocket for driver real-time updates."""
    await manager.connect_driver(websocket, driver_id)
    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            
            if message.get('type') == 'location_update':
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
            elif message.get('type') == 'ping':
                await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        manager.disconnect_driver(driver_id)


@app.websocket("/api/ws/civilian")
async def websocket_civilian(websocket: WebSocket):
    """WebSocket for civilian app traffic clearing alerts."""
    await manager.connect_civilian(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            if message.get('type') == 'ping':
                await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        manager.disconnect_civilian(websocket)


# ============== HELPER FUNCTIONS ==============
async def get_traffic_level(location: Coordinates) -> int:
    """Get traffic level (1-5) near a location."""
    events = await db.traffic_events.find({"resolved": False}, {"_id": 0}).to_list(100)
    
    max_severity = 1
    for event in events:
        event_loc = Coordinates(lat=event['location']['lat'], lng=event['location']['lng'])
        distance = haversine_distance(location, event_loc)
        if distance < 3:  # Within 3km
            max_severity = max(max_severity, event.get('severity', 1))
    
    return max_severity


# ============== ROOT ==============
@api_router.get("/")
async def root():
    return {"message": "Smart Ambulance Routing System API", "version": "2.0.0"}


@api_router.get("/health")
async def health():
    return {"status": "healthy"}


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
