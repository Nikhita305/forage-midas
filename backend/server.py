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
    Trip, TripStatus, TrafficAlert, AlertType, TrafficZone, CongestionLevel,
    RouteRequest, RouteResponse, Coordinates, StartTripRequest, EndTripRequest, 
    GPSPoint, ManualAlertRequest
)
from auth import (
    get_password_hash, verify_password, create_access_token,
    get_current_user, require_role
)
from routing import (
    compute_route, compute_alternate_route, rank_hospitals_by_eta, 
    haversine_distance, generate_mock_traffic_zones, get_congestion_level
)
from websocket_manager import manager

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI(title="Ambulance Emergency Traffic & Hospital Alert System")
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


# ============== AUTH ENDPOINTS ==============
@api_router.post("/auth/register", response_model=Token)
async def register(user_data: UserCreate):
    existing = await db.users.find_one({"email": user_data.email}, {"_id": 0})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    user = User(email=user_data.email, name=user_data.name, role=user_data.role)
    user_in_db = UserInDB(**user.model_dump(), hashed_password=get_password_hash(user_data.password))
    
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
    
    user = User(id=user_doc['id'], email=user_doc['email'], name=user_doc['name'], role=user_doc['role'])
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
    ambulances = await db.ambulances.find(
        {"$or": [{"driver_id": None}, {"driver_id": ""}], "status": "available"}, 
        {"_id": 0}
    ).to_list(100)
    return [Ambulance(**a) for a in ambulances]


@api_router.get("/ambulances/my", response_model=Optional[Ambulance])
async def get_my_ambulance(current_user: dict = Depends(get_current_user)):
    ambulance = await db.ambulances.find_one({"driver_id": current_user['sub']}, {"_id": 0})
    if ambulance:
        return Ambulance(**ambulance)
    return None


@api_router.post("/ambulances", response_model=Ambulance)
async def create_ambulance(ambulance_data: AmbulanceCreate, current_user: dict = Depends(require_role(["admin"]))):
    ambulance = Ambulance(call_sign=ambulance_data.call_sign, location=ambulance_data.location)
    doc = ambulance.model_dump()
    doc['last_updated'] = doc['last_updated'].isoformat()
    doc['location'] = {'lat': doc['location']['lat'], 'lng': doc['location']['lng']}
    await db.ambulances.insert_one(doc)
    return ambulance


@api_router.post("/ambulance/location")
async def update_ambulance_location(update: AmbulanceLocationUpdate, current_user: dict = Depends(get_current_user)):
    """Update ambulance GPS location - high frequency during trips."""
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
    
    # Update trip GPS history
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
    
    # Check if in severe traffic and auto-send alert
    if ambulance and ambulance.get('emergency_mode'):
        traffic_zones = await get_traffic_zones_near(update.location)
        for zone in traffic_zones:
            if zone.congestion_level == CongestionLevel.SEVERE:
                # Auto-send high congestion alert
                await send_auto_congestion_alert(ambulance, update.location, zone)
                break
    
    return {"status": "updated", "location": {"lat": update.location.lat, "lng": update.location.lng}}


@api_router.post("/ambulance/{ambulance_id}/claim")
async def claim_ambulance(ambulance_id: str, current_user: dict = Depends(get_current_user)):
    ambulance = await db.ambulances.find_one({"id": ambulance_id}, {"_id": 0})
    if not ambulance:
        raise HTTPException(status_code=404, detail="Ambulance not found")
    
    if ambulance.get('driver_id') and ambulance['driver_id'] != current_user['sub']:
        raise HTTPException(status_code=400, detail="Ambulance already assigned")
    
    existing = await db.ambulances.find_one({"driver_id": current_user['sub']}, {"_id": 0})
    if existing and existing['id'] != ambulance_id:
        raise HTTPException(status_code=400, detail="You already have an ambulance")
    
    await db.ambulances.update_one(
        {"id": ambulance_id},
        {"$set": {
            "driver_id": current_user['sub'],
            "driver_name": current_user['name'],
            "status": "available",
            "last_updated": datetime.now(timezone.utc).isoformat()
        }}
    )
    return {"status": "claimed"}


@api_router.post("/ambulance/{ambulance_id}/release")
async def release_ambulance(ambulance_id: str, current_user: dict = Depends(get_current_user)):
    ambulance = await db.ambulances.find_one({"id": ambulance_id}, {"_id": 0})
    if not ambulance:
        raise HTTPException(status_code=404, detail="Ambulance not found")
    
    if ambulance.get('driver_id') != current_user['sub']:
        raise HTTPException(status_code=403, detail="Not your ambulance")
    
    if ambulance.get('current_trip_id'):
        raise HTTPException(status_code=400, detail="Cannot release during active trip")
    
    await db.ambulances.update_one(
        {"id": ambulance_id},
        {"$set": {
            "driver_id": None, "driver_name": None, "status": "available",
            "emergency_mode": False, "last_updated": datetime.now(timezone.utc).isoformat()
        }}
    )
    return {"status": "released"}


@api_router.post("/ambulance/{ambulance_id}/emergency")
async def toggle_emergency_mode(ambulance_id: str, enable: bool = True, current_user: dict = Depends(get_current_user)):
    """Toggle emergency mode - when ON, begin sending alerts."""
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
        {"$set": {
            "status": new_status.value,
            "emergency_mode": enable,
            "last_updated": datetime.now(timezone.utc).isoformat()
        }}
    )
    
    alert_sent = False
    if enable:
        # Send emergency approach alert
        alert = TrafficAlert(
            ambulance_id=ambulance_id,
            ambulance_call_sign=ambulance['call_sign'],
            driver_name=current_user['name'],
            alert_type=AlertType.EMERGENCY_APPROACH,
            message="🚨 Ambulance approaching — clear path immediately!",
            location=Coordinates(**ambulance['location']),
            speed=ambulance.get('speed', 0),
            direction="en route"
        )
        
        doc = alert.model_dump()
        doc['created_at'] = doc['created_at'].isoformat()
        doc['location'] = {'lat': doc['location']['lat'], 'lng': doc['location']['lng']}
        await db.traffic_alerts.insert_one(doc)
        
        # Broadcast via WebSocket
        recipients = await manager.broadcast_traffic_alert({
            "alert_id": alert.id,
            "type": "EMERGENCY_APPROACH",
            "ambulance_call_sign": ambulance['call_sign'],
            "driver_name": current_user['name'],
            "message": alert.message,
            "location": {"lat": ambulance['location']['lat'], "lng": ambulance['location']['lng']},
            "speed": ambulance.get('speed', 0)
        })
        alert_sent = True
    
    return {
        "status": "emergency_enabled" if enable else "emergency_disabled",
        "alert_sent": alert_sent
    }


# ============== TRAFFIC ALERT ENDPOINTS ==============
@api_router.post("/alerts/traffic", response_model=TrafficAlert)
async def send_manual_traffic_alert(request: ManualAlertRequest, current_user: dict = Depends(get_current_user)):
    """Manually send alert to traffic police/control center."""
    ambulance = await db.ambulances.find_one({"id": request.ambulance_id}, {"_id": 0})
    if not ambulance:
        raise HTTPException(status_code=404, detail="Ambulance not found")
    
    if ambulance.get('driver_id') != current_user['sub']:
        raise HTTPException(status_code=403, detail="Not your ambulance")
    
    # Get current trip destination if available
    destination_hospital = None
    if ambulance.get('current_trip_id'):
        trip = await db.trips.find_one({"id": ambulance['current_trip_id']}, {"_id": 0})
        if trip:
            destination_hospital = trip.get('destination_hospital_name')
    
    alert = TrafficAlert(
        ambulance_id=request.ambulance_id,
        ambulance_call_sign=ambulance['call_sign'],
        driver_name=current_user['name'],
        alert_type=AlertType.MANUAL_REQUEST,
        message=request.message,
        location=request.location,
        speed=ambulance.get('speed', 0),
        direction="en route",
        eta_minutes=request.eta_minutes,
        destination_hospital=destination_hospital
    )
    
    doc = alert.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    doc['location'] = {'lat': doc['location']['lat'], 'lng': doc['location']['lng']}
    await db.traffic_alerts.insert_one(doc)
    
    # Broadcast alert
    await manager.broadcast_traffic_alert({
        "alert_id": alert.id,
        "type": "MANUAL_REQUEST",
        "ambulance_call_sign": ambulance['call_sign'],
        "driver_name": current_user['name'],
        "message": alert.message,
        "location": {"lat": request.location.lat, "lng": request.location.lng},
        "speed": ambulance.get('speed', 0),
        "eta_minutes": request.eta_minutes,
        "destination_hospital": destination_hospital
    })
    
    # Update trip alerts count
    if ambulance.get('current_trip_id'):
        await db.trips.update_one(
            {"id": ambulance['current_trip_id']},
            {"$inc": {"alerts_sent": 1}}
        )
    
    return alert


@api_router.get("/alerts/traffic", response_model=List[TrafficAlert])
async def get_traffic_alerts(limit: int = 50, current_user: dict = Depends(get_current_user)):
    """Get recent traffic alerts."""
    alerts = await db.traffic_alerts.find({}, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)
    return alerts


@api_router.get("/alerts/recent")
async def get_recent_alerts():
    """Get recent alerts from WebSocket history (no auth required for demo)."""
    return manager.get_recent_alerts(20)


# ============== HOSPITAL ENDPOINTS ==============
@api_router.get("/hospitals", response_model=List[Hospital])
async def get_hospitals(current_user: dict = Depends(get_current_user)):
    hospitals = await db.hospitals.find({}, {"_id": 0}).to_list(100)
    return [Hospital(**h) for h in hospitals]


@api_router.get("/hospitals/nearby")
async def get_nearby_hospitals(lat: float = Query(...), lng: float = Query(...), current_user: dict = Depends(get_current_user)):
    """Get hospitals ranked by ETA with traffic consideration."""
    hospitals = await db.hospitals.find({}, {"_id": 0}).to_list(100)
    location = Coordinates(lat=lat, lng=lng)
    traffic_zones = await get_traffic_zones_near(location)
    ranked = rank_hospitals_by_eta(location, hospitals, traffic_zones)
    return ranked[:10]


@api_router.get("/hospitals/{hospital_id}", response_model=Hospital)
async def get_hospital(hospital_id: str, current_user: dict = Depends(get_current_user)):
    hospital = await db.hospitals.find_one({"id": hospital_id}, {"_id": 0})
    if not hospital:
        raise HTTPException(status_code=404, detail="Hospital not found")
    return Hospital(**hospital)


# ============== ROUTE ENDPOINTS ==============
@api_router.get("/route/optimal", response_model=RouteResponse)
async def get_optimal_route(
    ambulance_id: str,
    dest_lat: float,
    dest_lng: float,
    current_user: dict = Depends(get_current_user)
):
    """Get optimal route with traffic awareness."""
    ambulance = await db.ambulances.find_one({"id": ambulance_id}, {"_id": 0})
    if not ambulance:
        raise HTTPException(status_code=404, detail="Ambulance not found")
    
    start = Coordinates(lat=ambulance['location']['lat'], lng=ambulance['location']['lng'])
    destination = Coordinates(lat=dest_lat, lng=dest_lng)
    
    traffic_zones = await get_traffic_zones_near(start)
    traffic_zones_list = [TrafficZone(**z) for z in traffic_zones] if traffic_zones else generate_mock_traffic_zones(start)
    
    primary_route = compute_route(start, destination, traffic_zones_list, ambulance.get('emergency_mode', False))
    alternate_route = compute_alternate_route(start, destination, traffic_zones_list)
    
    return RouteResponse(
        primary_route=primary_route,
        alternate_route=alternate_route,
        traffic_zones=traffic_zones_list
    )


@api_router.post("/route/to-hospital/{hospital_id}", response_model=RouteResponse)
async def calculate_route_to_hospital(hospital_id: str, ambulance_id: str, current_user: dict = Depends(get_current_user)):
    """Calculate route to specific hospital with traffic zones."""
    ambulance = await db.ambulances.find_one({"id": ambulance_id}, {"_id": 0})
    hospital = await db.hospitals.find_one({"id": hospital_id}, {"_id": 0})
    
    if not ambulance:
        raise HTTPException(status_code=404, detail="Ambulance not found")
    if not hospital:
        raise HTTPException(status_code=404, detail="Hospital not found")
    
    start = Coordinates(lat=ambulance['location']['lat'], lng=ambulance['location']['lng'])
    end = Coordinates(lat=hospital['coordinates']['lat'], lng=hospital['coordinates']['lng'])
    
    traffic_zones = await get_traffic_zones_near(start)
    traffic_zones_list = [TrafficZone(**z) for z in traffic_zones] if traffic_zones else generate_mock_traffic_zones(start)
    
    primary_route = compute_route(start, end, traffic_zones_list, True)
    alternate_route = compute_alternate_route(start, end, traffic_zones_list)
    
    return RouteResponse(
        primary_route=primary_route,
        alternate_route=alternate_route,
        destination_hospital=Hospital(**hospital),
        traffic_zones=traffic_zones_list
    )


# ============== TRAFFIC ZONE ENDPOINTS ==============
@api_router.get("/traffic/zones")
async def get_traffic_zones(lat: float = Query(...), lng: float = Query(...)):
    """Get traffic congestion zones near location."""
    location = Coordinates(lat=lat, lng=lng)
    zones = await get_traffic_zones_near(location)
    if not zones:
        # Return mock data if no real data
        mock_zones = generate_mock_traffic_zones(location)
        return [z.model_dump() for z in mock_zones]
    return zones


@api_router.post("/traffic/zones", response_model=TrafficZone)
async def create_traffic_zone(zone: TrafficZone, current_user: dict = Depends(require_role(["admin"]))):
    """Admin: Create traffic congestion zone."""
    doc = zone.model_dump()
    doc['location'] = {'lat': doc['location']['lat'], 'lng': doc['location']['lng']}
    await db.traffic_zones.insert_one(doc)
    return zone


# ============== TRIP ENDPOINTS ==============
@api_router.post("/trip/start", response_model=Trip)
async def start_trip(request: StartTripRequest, current_user: dict = Depends(get_current_user)):
    """Start trip to hospital."""
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
    
    start_loc = Coordinates(lat=ambulance['location']['lat'], lng=ambulance['location']['lng'])
    end_loc = Coordinates(lat=hospital['coordinates']['lat'], lng=hospital['coordinates']['lng'])
    
    traffic_zones = await get_traffic_zones_near(start_loc)
    traffic_zones_list = [TrafficZone(**z) for z in traffic_zones] if traffic_zones else generate_mock_traffic_zones(start_loc)
    
    route = compute_route(start_loc, end_loc, traffic_zones_list, True)
    
    trip = Trip(
        ambulance_id=request.ambulance_id,
        driver_id=current_user['sub'],
        driver_name=current_user['name'],
        destination_hospital_id=request.hospital_id,
        destination_hospital_name=hospital['name'],
        start_location=start_loc,
        end_location=end_loc,
        route=route,
        congestion_level=route.congestion_level
    )
    
    doc = trip.model_dump()
    doc['started_at'] = doc['started_at'].isoformat()
    doc['route']['points'] = [p.model_dump() if hasattr(p, 'model_dump') else p for p in doc['route']['points']]
    await db.trips.insert_one(doc)
    
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
async def end_trip(request: EndTripRequest, current_user: dict = Depends(get_current_user)):
    """End current trip."""
    trip = await db.trips.find_one({"id": request.trip_id}, {"_id": 0})
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")
    if trip['driver_id'] != current_user['sub']:
        raise HTTPException(status_code=403, detail="Not your trip")
    if trip['status'] != 'active':
        raise HTTPException(status_code=400, detail="Trip already ended")
    
    await db.trips.update_one(
        {"id": request.trip_id},
        {"$set": {"status": TripStatus.COMPLETED.value, "completed_at": datetime.now(timezone.utc).isoformat()}}
    )
    
    await db.ambulances.update_one(
        {"id": trip['ambulance_id']},
        {"$set": {
            "status": AmbulanceStatus.AVAILABLE.value,
            "current_trip_id": None,
            "emergency_mode": False,
            "last_updated": datetime.now(timezone.utc).isoformat()
        }}
    )
    
    return {"status": "completed", "trip_id": request.trip_id}


@api_router.get("/trip/current", response_model=Optional[Trip])
async def get_current_trip(current_user: dict = Depends(get_current_user)):
    trip = await db.trips.find_one({"driver_id": current_user['sub'], "status": "active"}, {"_id": 0})
    if trip:
        return Trip(**trip)
    return None


@api_router.get("/trips/history", response_model=List[Trip])
async def get_trip_history(limit: int = 20, current_user: dict = Depends(get_current_user)):
    trips = await db.trips.find({"driver_id": current_user['sub']}, {"_id": 0}).sort("started_at", -1).limit(limit).to_list(limit)
    return [Trip(**t) for t in trips]


# ============== V2X API (Future Traffic Light Preemption) ==============
@api_router.post("/v2x/preemption")
async def request_traffic_preemption(
    ambulance_id: str,
    intersection_lat: float,
    intersection_lng: float,
    current_user: dict = Depends(get_current_user)
):
    """API endpoint for future traffic light preemption (green wave activation)."""
    ambulance = await db.ambulances.find_one({"id": ambulance_id}, {"_id": 0})
    if not ambulance:
        raise HTTPException(status_code=404, detail="Ambulance not found")
    
    preemption_request = {
        "ambulance_id": ambulance_id,
        "ambulance_call_sign": ambulance['call_sign'],
        "intersection": {"lat": intersection_lat, "lng": intersection_lng},
        "ambulance_location": ambulance['location'],
        "speed": ambulance.get('speed', 0),
        "emergency_mode": ambulance.get('emergency_mode', False),
        "requested_at": datetime.now(timezone.utc).isoformat(),
        "response": "PREEMPTION_QUEUED"
    }
    
    await db.v2x_requests.insert_one(preemption_request)
    
    return {
        "status": "preemption_requested",
        "message": "Traffic signal preemption request queued (V2X integration pending)",
        "intersection": {"lat": intersection_lat, "lng": intersection_lng},
        "estimated_activation": "15 seconds"
    }


# ============== ADMIN ENDPOINTS ==============
@api_router.get("/admin/users", response_model=List[User])
async def get_users(current_user: dict = Depends(require_role(["admin"]))):
    users = await db.users.find({}, {"_id": 0, "hashed_password": 0}).to_list(100)
    return [User(**u) for u in users]


@api_router.get("/admin/trips", response_model=List[Trip])
async def get_all_trips(limit: int = 50, current_user: dict = Depends(require_role(["admin"]))):
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
    """Seed sample data."""
    hospitals = [
        Hospital(name="City General Hospital", coordinates=Coordinates(lat=40.7128, lng=-74.0060), 
                 phone="555-0100", specialties=["trauma", "cardiac", "general"], address="123 Main St"),
        Hospital(name="St. Mary's Medical Center", coordinates=Coordinates(lat=40.7200, lng=-74.0100),
                 phone="555-0101", specialties=["pediatric", "general"], address="456 Oak Ave"),
        Hospital(name="Metro Heart Institute", coordinates=Coordinates(lat=40.7050, lng=-73.9900),
                 phone="555-0102", specialties=["cardiac", "stroke"], address="789 Heart Blvd"),
        Hospital(name="Children's Healthcare", coordinates=Coordinates(lat=40.7300, lng=-74.0200),
                 phone="555-0103", specialties=["pediatric", "neonatal"], address="321 Kids Way"),
        Hospital(name="Trauma Level 1 Center", coordinates=Coordinates(lat=40.7180, lng=-73.9950),
                 phone="555-0104", specialties=["trauma", "burns", "surgery"], address="555 Emergency Dr"),
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
    
    # Seed traffic zones
    center = Coordinates(lat=40.7128, lng=-74.0060)
    mock_zones = generate_mock_traffic_zones(center)
    for zone in mock_zones:
        doc = zone.model_dump()
        doc['location'] = {'lat': doc['location']['lat'], 'lng': doc['location']['lng']}
        await db.traffic_zones.insert_one(doc)
    
    return {"status": "seeded", "hospitals": len(hospitals), "ambulances": len(ambulances), "traffic_zones": len(mock_zones)}


# ============== WEBSOCKET ENDPOINTS ==============
@app.websocket("/api/ws/driver/{driver_id}")
async def websocket_driver(websocket: WebSocket, driver_id: str):
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


@app.websocket("/api/ws/alerts")
async def websocket_traffic_alerts(websocket: WebSocket):
    """WebSocket for receiving traffic alerts (future: traffic police app)."""
    await manager.connect_traffic_listener(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            if message.get('type') == 'ping':
                await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        manager.disconnect_traffic_listener(websocket)


# ============== HELPER FUNCTIONS ==============
async def get_traffic_zones_near(location: Coordinates) -> List[dict]:
    """Get traffic zones near a location."""
    zones = await db.traffic_zones.find({}, {"_id": 0}).to_list(100)
    nearby = []
    for zone in zones:
        zone_loc = Coordinates(lat=zone['location']['lat'], lng=zone['location']['lng'])
        if haversine_distance(location, zone_loc) < 5:  # Within 5km
            nearby.append(zone)
    return nearby


async def send_auto_congestion_alert(ambulance: dict, location: Coordinates, zone: TrafficZone):
    """Automatically send alert when hitting severe congestion."""
    alert = TrafficAlert(
        ambulance_id=ambulance['id'],
        ambulance_call_sign=ambulance['call_sign'],
        driver_name=ambulance.get('driver_name', 'Unknown'),
        alert_type=AlertType.HIGH_CONGESTION,
        message=f"🚨 High congestion detected — assist ambulance {ambulance['call_sign']} movement!",
        location=location,
        speed=ambulance.get('speed', 0),
        congestion_level=zone.congestion_level
    )
    
    doc = alert.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    doc['location'] = {'lat': doc['location']['lat'], 'lng': doc['location']['lng']}
    await db.traffic_alerts.insert_one(doc)
    
    await manager.broadcast_traffic_alert({
        "alert_id": alert.id,
        "type": "HIGH_CONGESTION_AUTO",
        "ambulance_call_sign": ambulance['call_sign'],
        "message": alert.message,
        "location": {"lat": location.lat, "lng": location.lng},
        "congestion_level": zone.congestion_level.value
    })


# ============== ROOT ==============
@api_router.get("/")
async def root():
    return {"message": "Ambulance Emergency Traffic & Hospital Alert System", "version": "3.0.0"}


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
