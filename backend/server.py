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
    Hospital, Ambulance, AmbulanceStatus, AmbulanceLocationUpdate, AmbulanceLocation,
    TrafficAlert, AlertStatus, Coordinates,
    SendAlertRequest, AcknowledgeAlertRequest, ClearRouteRequest
)
from auth import (
    get_password_hash, verify_password, create_access_token,
    get_current_user, require_role
)
from routing import haversine_distance, rank_hospitals_by_eta, calculate_distance_to_traffic_point, get_direction_of_travel
from websocket_manager import manager

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI(title="Ambulance Emergency Traffic Alert System")
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# ============== AUTH ENDPOINTS ==============
@api_router.post("/auth/login", response_model=Token)
async def login(credentials: UserLogin):
    """Login for both ambulance drivers and traffic police."""
    user_doc = await db.users.find_one({"email": credentials.email}, {"_id": 0})
    if not user_doc or not verify_password(credentials.password, user_doc['hashed_password']):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    user = User(id=user_doc['id'], email=user_doc['email'], name=user_doc['name'], role=user_doc['role'])
    token = create_access_token({"sub": user.id, "email": user.email, "role": user.role, "name": user.name})
    return Token(access_token=token, user=user)


@api_router.post("/auth/register", response_model=Token)
async def register(user_data: UserCreate):
    """Register new user (driver or police)."""
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


@api_router.get("/auth/me", response_model=User)
async def get_me(current_user: dict = Depends(get_current_user)):
    user_doc = await db.users.find_one({"id": current_user['sub']}, {"_id": 0, "hashed_password": 0})
    if not user_doc:
        raise HTTPException(status_code=404, detail="User not found")
    return User(**user_doc)


# ============== AMBULANCE DRIVER ENDPOINTS ==============
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


@api_router.post("/ambulance/{ambulance_id}/claim")
async def claim_ambulance(ambulance_id: str, current_user: dict = Depends(get_current_user)):
    ambulance = await db.ambulances.find_one({"id": ambulance_id}, {"_id": 0})
    if not ambulance:
        raise HTTPException(status_code=404, detail="Ambulance not found")
    
    if ambulance.get('driver_id') and ambulance['driver_id'] != current_user['sub']:
        raise HTTPException(status_code=400, detail="Ambulance already assigned")
    
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
    
    await db.ambulances.update_one(
        {"id": ambulance_id},
        {"$set": {
            "driver_id": None, "driver_name": None, "status": "available",
            "emergency_mode": False, "last_updated": datetime.now(timezone.utc).isoformat()
        }}
    )
    return {"status": "released"}


@api_router.get("/ambulance/location")
async def get_ambulance_location(ambulance_id: str, current_user: dict = Depends(get_current_user)):
    """Get current ambulance location."""
    ambulance = await db.ambulances.find_one({"id": ambulance_id}, {"_id": 0})
    if not ambulance:
        raise HTTPException(status_code=404, detail="Ambulance not found")
    
    return {
        "ambulance_id": ambulance['id'],
        "call_sign": ambulance['call_sign'],
        "location": ambulance['location'],
        "speed": ambulance.get('speed', 0),
        "status": ambulance['status'],
        "last_updated": ambulance.get('last_updated')
    }


@api_router.post("/ambulance/location")
async def update_ambulance_location(update: AmbulanceLocationUpdate, current_user: dict = Depends(get_current_user)):
    """Update ambulance GPS location."""
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
    
    # Store location history
    location_record = AmbulanceLocation(
        ambulance_id=update.ambulance_id,
        lat=update.location.lat,
        lng=update.location.lng,
        speed=update.speed
    )
    doc = location_record.model_dump()
    doc['time'] = doc['time'].isoformat()
    await db.ambulance_locations.insert_one(doc)
    
    # Broadcast to police if ambulance has active alert
    ambulance = await db.ambulances.find_one({"id": update.ambulance_id}, {"_id": 0})
    if ambulance and ambulance.get('emergency_mode'):
        await manager.send_ambulance_location_update({
            "ambulance_id": update.ambulance_id,
            "call_sign": ambulance['call_sign'],
            "driver_name": ambulance.get('driver_name', 'Unknown'),
            "location": {"lat": update.location.lat, "lng": update.location.lng},
            "speed": update.speed,
            "direction": get_direction_of_travel(update.speed, update.heading)
        })
    
    return {"status": "updated"}


@api_router.post("/ambulance/{ambulance_id}/emergency")
async def toggle_emergency_mode(ambulance_id: str, enable: bool = True, current_user: dict = Depends(get_current_user)):
    """Toggle emergency mode."""
    ambulance = await db.ambulances.find_one({"id": ambulance_id}, {"_id": 0})
    if not ambulance:
        raise HTTPException(status_code=404, detail="Ambulance not found")
    
    if ambulance.get('driver_id') != current_user['sub']:
        raise HTTPException(status_code=403, detail="Not your ambulance")
    
    await db.ambulances.update_one(
        {"id": ambulance_id},
        {"$set": {
            "status": AmbulanceStatus.EMERGENCY.value if enable else AmbulanceStatus.AVAILABLE.value,
            "emergency_mode": enable,
            "last_updated": datetime.now(timezone.utc).isoformat()
        }}
    )
    
    return {"status": "emergency_enabled" if enable else "emergency_disabled"}


# ============== ALERT ENDPOINTS ==============
@api_router.post("/alert/send", response_model=TrafficAlert)
async def send_traffic_alert(request: SendAlertRequest, current_user: dict = Depends(get_current_user)):
    """
    AMBULANCE DRIVER: Send traffic alert to all logged-in traffic police.
    This is the main "Send Traffic Alert" button functionality.
    """
    ambulance = await db.ambulances.find_one({"id": request.ambulance_id}, {"_id": 0})
    if not ambulance:
        raise HTTPException(status_code=404, detail="Ambulance not found")
    
    if ambulance.get('driver_id') != current_user['sub']:
        raise HTTPException(status_code=403, detail="Not your ambulance")
    
    # Calculate distance to nearest traffic point
    distance_to_traffic = calculate_distance_to_traffic_point(request.location)
    
    # Create alert
    alert = TrafficAlert(
        ambulance_id=request.ambulance_id,
        ambulance_call_sign=ambulance['call_sign'],
        driver_id=current_user['sub'],
        driver_name=current_user['name'],
        location=request.location,
        speed=request.speed,
        direction=get_direction_of_travel(request.speed),
        distance_to_traffic_point=distance_to_traffic,
        message=request.message
    )
    
    # Save to database
    doc = alert.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    doc['location'] = {'lat': doc['location']['lat'], 'lng': doc['location']['lng']}
    await db.alerts.insert_one(doc)
    
    # Enable emergency mode on ambulance
    await db.ambulances.update_one(
        {"id": request.ambulance_id},
        {"$set": {"emergency_mode": True, "status": AmbulanceStatus.EMERGENCY.value}}
    )
    
    # Broadcast to ALL logged-in traffic police via WebSocket
    recipients = await manager.send_alert_to_police({
        "alert_id": alert.id,
        "ambulance_id": alert.ambulance_id,
        "ambulance_call_sign": alert.ambulance_call_sign,
        "driver_name": alert.driver_name,
        "location": {"lat": request.location.lat, "lng": request.location.lng},
        "speed": request.speed,
        "direction": alert.direction,
        "distance_to_traffic_point_km": distance_to_traffic,
        "distance_to_traffic_point_m": int(distance_to_traffic * 1000),
        "message": alert.message,
        "status": alert.status.value,
        "created_at": alert.created_at.isoformat()
    })
    
    return alert


@api_router.get("/alerts/live", response_model=List[TrafficAlert])
async def get_live_alerts(current_user: dict = Depends(get_current_user)):
    """
    TRAFFIC POLICE: Get all active/live alerts.
    Active alerts shown at the top.
    """
    alerts = await db.alerts.find(
        {"status": {"$in": ["active", "acknowledged"]}},
        {"_id": 0}
    ).sort("created_at", -1).to_list(50)
    
    # Sort: active first, then acknowledged
    alerts.sort(key=lambda x: (0 if x.get('status') == 'active' else 1, x.get('created_at', '')))
    
    return alerts


@api_router.get("/alerts/history", response_model=List[TrafficAlert])
async def get_alert_history(limit: int = 50, current_user: dict = Depends(get_current_user)):
    """Get alert history."""
    alerts = await db.alerts.find({}, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)
    return alerts


@api_router.get("/alerts/my", response_model=List[TrafficAlert])
async def get_my_alerts(current_user: dict = Depends(get_current_user)):
    """AMBULANCE DRIVER: Get alerts sent by this driver."""
    alerts = await db.alerts.find(
        {"driver_id": current_user['sub']},
        {"_id": 0}
    ).sort("created_at", -1).limit(20).to_list(20)
    return alerts


@api_router.post("/alert/acknowledge")
async def acknowledge_alert(request: AcknowledgeAlertRequest, current_user: dict = Depends(get_current_user)):
    """
    TRAFFIC POLICE: Acknowledge an alert.
    Updates the ambulance driver's screen.
    """
    if current_user.get('role') != 'police':
        raise HTTPException(status_code=403, detail="Only traffic police can acknowledge alerts")
    
    alert = await db.alerts.find_one({"id": request.alert_id}, {"_id": 0})
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    
    if alert['status'] != 'active':
        raise HTTPException(status_code=400, detail="Alert already processed")
    
    await db.alerts.update_one(
        {"id": request.alert_id},
        {"$set": {
            "status": AlertStatus.ACKNOWLEDGED.value,
            "acknowledged_by": current_user['sub'],
            "acknowledged_at": datetime.now(timezone.utc).isoformat()
        }}
    )
    
    # Notify the ambulance driver
    await manager.send_status_update_to_driver(alert['driver_id'], "alert_acknowledged", {
        "alert_id": request.alert_id,
        "acknowledged_by": current_user['name'],
        "message": f"Alert acknowledged by {current_user['name']}"
    })
    
    # Notify all police about status change
    await manager.broadcast_to_all_police({
        "type": "alert_status_change",
        "data": {
            "alert_id": request.alert_id,
            "new_status": "acknowledged",
            "acknowledged_by": current_user['name']
        }
    })
    
    return {"status": "acknowledged", "acknowledged_by": current_user['name']}


@api_router.post("/alert/clear")
async def clear_route(request: ClearRouteRequest, current_user: dict = Depends(get_current_user)):
    """
    TRAFFIC POLICE: Mark route as cleared.
    Updates the ambulance driver's screen.
    """
    if current_user.get('role') != 'police':
        raise HTTPException(status_code=403, detail="Only traffic police can clear routes")
    
    alert = await db.alerts.find_one({"id": request.alert_id}, {"_id": 0})
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    
    await db.alerts.update_one(
        {"id": request.alert_id},
        {"$set": {
            "status": AlertStatus.CLEARED.value,
            "cleared_by": current_user['sub'],
            "cleared_at": datetime.now(timezone.utc).isoformat()
        }}
    )
    
    # Disable emergency mode on ambulance
    await db.ambulances.update_one(
        {"id": alert['ambulance_id']},
        {"$set": {"emergency_mode": False, "status": AmbulanceStatus.AVAILABLE.value}}
    )
    
    # Notify the ambulance driver
    await manager.send_status_update_to_driver(alert['driver_id'], "route_cleared", {
        "alert_id": request.alert_id,
        "cleared_by": current_user['name'],
        "message": request.message
    })
    
    # Notify all police about status change
    await manager.broadcast_to_all_police({
        "type": "alert_status_change",
        "data": {
            "alert_id": request.alert_id,
            "new_status": "cleared",
            "cleared_by": current_user['name']
        }
    })
    
    return {"status": "cleared", "cleared_by": current_user['name']}


# ============== HOSPITAL ENDPOINTS ==============
@api_router.get("/hospitals/nearby")
async def get_nearby_hospitals(lat: float = Query(...), lng: float = Query(...), current_user: dict = Depends(get_current_user)):
    """Get hospitals near ambulance location with name, distance, and ETA."""
    hospitals = await db.hospitals.find({}, {"_id": 0}).to_list(100)
    location = Coordinates(lat=lat, lng=lng)
    ranked = rank_hospitals_by_eta(location, hospitals)
    return ranked[:10]


@api_router.get("/hospitals", response_model=List[Hospital])
async def get_hospitals(current_user: dict = Depends(get_current_user)):
    hospitals = await db.hospitals.find({}, {"_id": 0}).to_list(100)
    return [Hospital(**h) for h in hospitals]


# ============== ADMIN ENDPOINTS ==============
@api_router.get("/admin/users", response_model=List[User])
async def get_users(current_user: dict = Depends(require_role(["admin"]))):
    users = await db.users.find({}, {"_id": 0, "hashed_password": 0}).to_list(100)
    return [User(**u) for u in users]


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
    ]
    
    for a in ambulances:
        existing = await db.ambulances.find_one({"call_sign": a.call_sign})
        if not existing:
            doc = a.model_dump()
            doc['last_updated'] = doc['last_updated'].isoformat()
            doc['location'] = {'lat': doc['location']['lat'], 'lng': doc['location']['lng']}
            await db.ambulances.insert_one(doc)
    
    return {"status": "seeded", "hospitals": len(hospitals), "ambulances": len(ambulances)}


@api_router.get("/stats")
async def get_stats(current_user: dict = Depends(get_current_user)):
    """Get system stats."""
    return {
        "connected_police": manager.get_connected_police_count(),
        "connected_drivers": manager.get_connected_driver_count(),
        "active_alerts": await db.alerts.count_documents({"status": "active"})
    }


# ============== WEBSOCKET ENDPOINTS ==============
@app.websocket("/api/ws/driver/{driver_id}")
async def websocket_driver(websocket: WebSocket, driver_id: str):
    """WebSocket for ambulance drivers to receive status updates."""
    await manager.connect_driver(websocket, driver_id)
    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            
            if message.get('type') == 'location_update':
                loc = message.get('data', {})
                if loc.get('ambulance_id'):
                    await db.ambulances.update_one(
                        {"id": loc['ambulance_id']},
                        {"$set": {
                            "location": {"lat": loc['lat'], "lng": loc['lng']},
                            "speed": loc.get('speed', 0),
                            "last_updated": datetime.now(timezone.utc).isoformat()
                        }}
                    )
            elif message.get('type') == 'ping':
                await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        manager.disconnect_driver(driver_id)


@app.websocket("/api/ws/police/{police_id}")
async def websocket_police(websocket: WebSocket, police_id: str):
    """WebSocket for traffic police to receive alerts and location updates."""
    await manager.connect_police(websocket, police_id)
    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            if message.get('type') == 'ping':
                await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        manager.disconnect_police(police_id)


# ============== ROOT ==============
@api_router.get("/")
async def root():
    return {"message": "Ambulance Emergency Traffic Alert System", "version": "4.0.0"}


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
