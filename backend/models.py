from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional
from datetime import datetime, timezone
from enum import Enum
import uuid


class UserRole(str, Enum):
    ADMIN = "admin"
    DRIVER = "driver"


class AmbulanceStatus(str, Enum):
    AVAILABLE = "available"
    ON_TRIP = "on_trip"
    EMERGENCY = "emergency"
    OFFLINE = "offline"


class TripStatus(str, Enum):
    ACTIVE = "active"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class CongestionLevel(str, Enum):
    LOW = "low"
    MODERATE = "moderate"
    HIGH = "high"
    SEVERE = "severe"


class AlertType(str, Enum):
    EMERGENCY_APPROACH = "emergency_approach"
    HIGH_CONGESTION = "high_congestion"
    ROUTE_BLOCKED = "route_blocked"
    MANUAL_REQUEST = "manual_request"


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
    specialties: List[str] = []
    address: str = ""
    eta_minutes: Optional[int] = None
    distance_km: Optional[float] = None


class TrafficZone(BaseModel):
    """Traffic congestion zone on the map."""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    location: Coordinates
    radius_km: float = 0.5
    congestion_level: CongestionLevel = CongestionLevel.LOW
    description: str = ""
    incident_type: Optional[str] = None  # accident, construction, event, etc.
    blocked: bool = False


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
    current_trip_id: Optional[str] = None
    emergency_mode: bool = False
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
    instruction: str = ""
    congestion: CongestionLevel = CongestionLevel.LOW


class Route(BaseModel):
    points: List[RoutePoint]
    distance_km: float
    duration_minutes: int
    traffic_delay_minutes: int = 0
    congestion_level: CongestionLevel = CongestionLevel.LOW
    next_turn: str = ""
    traffic_warnings: List[str] = []
    blocked_roads: List[str] = []


class RouteRequest(BaseModel):
    ambulance_id: str
    destination: Coordinates
    emergency: bool = True


class RouteResponse(BaseModel):
    primary_route: Route
    alternate_route: Optional[Route] = None
    destination_hospital: Optional[Hospital] = None
    traffic_zones: List[TrafficZone] = []


class GPSPoint(BaseModel):
    lat: float
    lng: float
    timestamp: datetime
    speed: float = 0


class Trip(BaseModel):
    model_config = ConfigDict(extra="ignore")
    
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    ambulance_id: str
    driver_id: str
    driver_name: str
    destination_hospital_id: str
    destination_hospital_name: str
    start_location: Coordinates
    end_location: Coordinates
    route: Optional[Route] = None
    gps_history: List[GPSPoint] = []
    status: TripStatus = TripStatus.ACTIVE
    started_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    completed_at: Optional[datetime] = None
    congestion_level: CongestionLevel = CongestionLevel.LOW
    alerts_sent: int = 0


class TrafficAlert(BaseModel):
    """Alert sent to traffic authorities."""
    model_config = ConfigDict(extra="ignore")
    
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    ambulance_id: str
    ambulance_call_sign: str
    driver_name: str
    alert_type: AlertType
    message: str
    location: Coordinates
    speed: float = 0
    direction: str = ""
    eta_minutes: Optional[int] = None
    destination_hospital: Optional[str] = None
    congestion_level: CongestionLevel = CongestionLevel.LOW
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    acknowledged: bool = False


class ManualAlertRequest(BaseModel):
    ambulance_id: str
    message: str = "Requesting traffic assistance - please clear path"
    location: Coordinates
    eta_minutes: Optional[int] = None


class StartTripRequest(BaseModel):
    ambulance_id: str
    hospital_id: str


class EndTripRequest(BaseModel):
    trip_id: str
