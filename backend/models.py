from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional
from datetime import datetime, timezone
from enum import Enum
import uuid


class UserRole(str, Enum):
    ADMIN = "admin"
    DRIVER = "driver"
    POLICE = "police"


class AmbulanceStatus(str, Enum):
    AVAILABLE = "available"
    ON_TRIP = "on_trip"
    EMERGENCY = "emergency"
    OFFLINE = "offline"


class AlertStatus(str, Enum):
    ACTIVE = "active"
    ACKNOWLEDGED = "acknowledged"
    CLEARED = "cleared"
    EXPIRED = "expired"


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
    emergency_mode: bool = False
    last_updated: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class AmbulanceLocationUpdate(BaseModel):
    ambulance_id: str
    location: Coordinates
    speed: float = 0
    heading: float = 0


class AmbulanceLocation(BaseModel):
    """Ambulance location history record."""
    model_config = ConfigDict(extra="ignore")
    
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    ambulance_id: str
    lat: float
    lng: float
    speed: float = 0
    time: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class TrafficAlert(BaseModel):
    """Alert sent from ambulance driver to traffic police."""
    model_config = ConfigDict(extra="ignore")
    
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    ambulance_id: str
    ambulance_call_sign: str
    driver_id: str
    driver_name: str
    location: Coordinates
    speed: float = 0
    direction: str = ""
    distance_to_traffic_point: Optional[float] = None
    message: str = "🚨 Ambulance approaching — please clear the route!"
    status: AlertStatus = AlertStatus.ACTIVE
    acknowledged_by: Optional[str] = None
    acknowledged_at: Optional[datetime] = None
    cleared_by: Optional[str] = None
    cleared_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class SendAlertRequest(BaseModel):
    ambulance_id: str
    location: Coordinates
    speed: float = 0
    message: str = "🚨 Ambulance approaching — please clear the route!"


class AcknowledgeAlertRequest(BaseModel):
    alert_id: str


class ClearRouteRequest(BaseModel):
    alert_id: str
    message: str = "Route cleared - proceed safely"


class SignalState(str, Enum):
    RED = "red"
    YELLOW = "yellow"
    GREEN = "green"


class TrafficLightMode(str, Enum):
    NORMAL = "normal"
    EMERGENCY = "emergency"
    MANUAL = "manual"


class TrafficLight(BaseModel):
    """Traffic light/junction in the system."""
    model_config = ConfigDict(extra="ignore")
    
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    coordinates: Coordinates
    current_state: SignalState = SignalState.RED
    mode: TrafficLightMode = TrafficLightMode.NORMAL
    normal_cycle_seconds: int = 120  # Normal cycle duration
    controlled_by_ambulance: Optional[str] = None  # ambulance_id if in emergency mode
    affected_lanes: List[str] = []  # e.g., ["North-South", "East-West"]
    last_state_change: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    activated_at: Optional[datetime] = None


class TrafficLightControl(BaseModel):
    """Manual control request for traffic light."""
    light_id: str
    state: SignalState
    duration_seconds: Optional[int] = None


class GreenCorridorStatus(BaseModel):
    """Status of green corridor for an ambulance."""
    ambulance_id: str
    active_lights: List[str] = []  # List of traffic light IDs
    upcoming_lights: List[str] = []  # Lights ambulance is approaching
    eta_to_next_junction: Optional[float] = None  # seconds
