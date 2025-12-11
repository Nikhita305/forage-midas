from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional
from datetime import datetime, timezone
from enum import Enum
import uuid


class UserRole(str, Enum):
    ADMIN = "admin"
    DISPATCHER = "dispatcher"
    DRIVER = "driver"


class AmbulanceStatus(str, Enum):
    AVAILABLE = "available"
    ON_ROUTE = "on_route"
    EMERGENCY = "emergency"
    OFFLINE = "offline"


class TripStatus(str, Enum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class Coordinates(BaseModel):
    lat: float
    lng: float


class UserCreate(BaseModel):
    email: str
    password: str
    name: str
    role: UserRole = UserRole.DRIVER


class UserLogin(BaseModel):
    email: str
    password: str


class User(BaseModel):
    model_config = ConfigDict(extra="ignore")
    
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    email: str
    name: str
    role: UserRole
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class UserInDB(User):
    hashed_password: str


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: User


class Hospital(BaseModel):
    model_config = ConfigDict(extra="ignore")
    
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    coordinates: Coordinates
    phone: str
    specialties: List[str]
    availability: int = Field(default=10, description="Available beds")
    address: str = ""
    eta_minutes: Optional[int] = None


class Ambulance(BaseModel):
    model_config = ConfigDict(extra="ignore")
    
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    call_sign: str
    driver_id: Optional[str] = None
    driver_name: Optional[str] = None
    status: AmbulanceStatus = AmbulanceStatus.AVAILABLE
    location: Coordinates
    speed: float = 0
    heading: float = 0
    assigned_hospital_id: Optional[str] = None
    current_trip_id: Optional[str] = None
    last_updated: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class AmbulanceCreate(BaseModel):
    call_sign: str
    location: Coordinates


class AmbulanceLocationUpdate(BaseModel):
    ambulance_id: str
    location: Coordinates
    speed: float = 0
    heading: float = 0


class RoutePoint(BaseModel):
    lat: float
    lng: float


class Route(BaseModel):
    points: List[RoutePoint]
    distance_km: float
    duration_minutes: int
    traffic_delay_minutes: int = 0


class RouteRequest(BaseModel):
    ambulance_id: str
    destination: Coordinates
    emergency: bool = True


class RouteResponse(BaseModel):
    primary_route: Route
    backup_routes: List[Route] = []
    recommended_hospital_id: Optional[str] = None


class Trip(BaseModel):
    model_config = ConfigDict(extra="ignore")
    
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    ambulance_id: str
    driver_id: Optional[str] = None
    start_location: Coordinates
    end_location: Optional[Coordinates] = None
    assigned_hospital_id: Optional[str] = None
    status: TripStatus = TripStatus.PENDING
    route: Optional[Route] = None
    started_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    completed_at: Optional[datetime] = None


class TrafficEvent(BaseModel):
    model_config = ConfigDict(extra="ignore")
    
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    event_type: str  # accident, congestion, road_closure
    location: Coordinates
    severity: int = Field(default=1, ge=1, le=5)
    description: str = ""
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    resolved: bool = False


class Alert(BaseModel):
    model_config = ConfigDict(extra="ignore")
    
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    ambulance_id: str
    message: str
    location: Coordinates
    radius_km: float = 1.0
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class AlertSend(BaseModel):
    ambulance_id: str
    location: Coordinates
    radius_km: float = 1.0


class AssignHospital(BaseModel):
    ambulance_id: str
    hospital_id: str


class AuditLog(BaseModel):
    model_config = ConfigDict(extra="ignore")
    
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    action: str
    details: str = ""
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
