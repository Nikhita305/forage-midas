"""
Smart Traffic Light System for Emergency Green Corridor
"""
from typing import List, Dict, Optional, Tuple
from datetime import datetime, timezone
import math
from models import TrafficLight, SignalState, TrafficLightMode, Coordinates, GreenCorridorStatus
from routing import haversine_distance

# Predefined traffic junctions in Karnataka, India (Bangalore focus)
KARNATAKA_TRAFFIC_JUNCTIONS = [
    {"name": "Silk Board Junction", "lat": 12.9173, "lng": 77.6226},
    {"name": "Marathahalli Junction", "lat": 12.9591, "lng": 77.6974},
    {"name": "KR Puram Junction", "lat": 13.0052, "lng": 77.6950},
    {"name": "Whitefield Main Road", "lat": 12.9698, "lng": 77.7499},
    {"name": "Electronic City Toll", "lat": 12.8456, "lng": 77.6603},
    {"name": "Bannerghatta Road Junction", "lat": 12.8996, "lng": 77.5977},
    {"name": "Jayanagar 4th Block", "lat": 12.9250, "lng": 77.5838},
    {"name": "MG Road Metro", "lat": 12.9756, "lng": 77.6065},
    {"name": "Koramangala 6th Block", "lat": 12.9352, "lng": 77.6245},
    {"name": "HSR Layout Junction", "lat": 12.9121, "lng": 77.6446},
    {"name": "Indiranagar 100 Feet Road", "lat": 12.9719, "lng": 77.6412},
    {"name": "Yeshwanthpur Circle", "lat": 13.0280, "lng": 77.5385},
    {"name": "Hebbal Flyover", "lat": 13.0358, "lng": 77.5970},
    {"name": "Mysore Road Satellite Town", "lat": 12.9539, "lng": 77.5399},
    {"name": "Kengeri Junction", "lat": 12.9077, "lng": 77.4854},
]

# Detection radius for green corridor activation (meters)
DETECTION_RADIUS = 300
# Speed threshold for emergency mode (km/h)
EMERGENCY_SPEED_THRESHOLD = 40
# Time buffer for prediction (seconds)
PREDICTION_BUFFER = 30


def initialize_traffic_lights() -> List[TrafficLight]:
    """Initialize all traffic light junctions."""
    lights = []
    for idx, junction in enumerate(KARNATAKA_TRAFFIC_JUNCTIONS):
        # Alternate initial states for realism
        initial_state = SignalState.GREEN if idx % 2 == 0 else SignalState.RED
        
        light = TrafficLight(
            name=junction["name"],
            coordinates=Coordinates(lat=junction["lat"], lng=junction["lng"]),
            current_state=initial_state,
            mode=TrafficLightMode.NORMAL,
            affected_lanes=["North-South", "East-West"] if idx % 3 != 0 else ["Main", "Cross"]
        )
        lights.append(light)
    return lights


def calculate_eta_to_junction(
    ambulance_location: Coordinates,
    ambulance_speed: float,
    junction_location: Coordinates
) -> Optional[float]:
    """
    Calculate ETA to junction using ML-inspired logic.
    
    Args:
        ambulance_location: Current ambulance position
        ambulance_speed: Current speed in km/h
        junction_location: Junction coordinates
    
    Returns:
        ETA in seconds, or None if not approaching
    """
    distance_km = haversine_distance(ambulance_location, junction_location)
    distance_m = distance_km * 1000
    
    # If junction is beyond detection radius + buffer, not relevant
    if distance_m > (DETECTION_RADIUS + 500):
        return None
    
    # Convert speed to m/s
    if ambulance_speed <= 0:
        ambulance_speed = 50  # Assume 50 km/h if no speed data
    
    speed_ms = ambulance_speed / 3.6
    
    # Calculate basic ETA
    eta_seconds = distance_m / speed_ms
    
    # Add smart adjustments (ML-inspired factors)
    # Factor 1: Traffic density (simulated based on time of day)
    hour = datetime.now(timezone.utc).hour
    traffic_factor = 1.0
    if 7 <= hour <= 9 or 17 <= hour <= 19:  # Rush hours
        traffic_factor = 1.3
    elif 22 <= hour or hour <= 6:  # Night
        traffic_factor = 0.8
    
    # Factor 2: Junction complexity (more lanes = more delay)
    junction_complexity_factor = 1.1
    
    # Apply factors
    adjusted_eta = eta_seconds * traffic_factor * junction_complexity_factor
    
    return adjusted_eta


def detect_approaching_junctions(
    ambulance_location: Coordinates,
    ambulance_speed: float,
    all_lights: List[TrafficLight]
) -> Tuple[List[TrafficLight], List[TrafficLight]]:
    """
    Detect which junctions need to be activated for green corridor.
    
    Returns:
        (immediate_activation, upcoming_junctions)
    """
    immediate = []
    upcoming = []
    
    for light in all_lights:
        distance_km = haversine_distance(ambulance_location, light.coordinates)
        distance_m = distance_km * 1000
        
        # Immediate activation zone (< 300m)
        if distance_m <= DETECTION_RADIUS:
            immediate.append(light)
        # Upcoming zone (300m - 800m) for predictive activation
        elif distance_m <= 800:
            eta = calculate_eta_to_junction(ambulance_location, ambulance_speed, light.coordinates)
            if eta and eta <= PREDICTION_BUFFER:
                upcoming.append(light)
    
    return immediate, upcoming


def activate_green_corridor(
    ambulance_id: str,
    ambulance_location: Coordinates,
    ambulance_speed: float,
    all_lights: List[TrafficLight]
) -> GreenCorridorStatus:
    """
    Activate green corridor for ambulance.
    
    This is the main smart logic that:
    1. Detects nearby junctions
    2. Activates green signal for ambulance lane
    3. Turns other lanes red
    4. Predicts upcoming junctions
    """
    immediate, upcoming = detect_approaching_junctions(
        ambulance_location,
        ambulance_speed,
        all_lights
    )
    
    active_light_ids = []
    upcoming_light_ids = []
    
    # Activate immediate junctions
    for light in immediate:
        if light.mode != TrafficLightMode.EMERGENCY or light.controlled_by_ambulance != ambulance_id:
            light.current_state = SignalState.GREEN
            light.mode = TrafficLightMode.EMERGENCY
            light.controlled_by_ambulance = ambulance_id
            light.activated_at = datetime.now(timezone.utc)
            light.last_state_change = datetime.now(timezone.utc)
        active_light_ids.append(light.id)
    
    # Track upcoming junctions (don't activate yet, but prepare)
    for light in upcoming:
        upcoming_light_ids.append(light.id)
    
    # Calculate ETA to next junction
    eta_to_next = None
    if upcoming:
        closest_upcoming = min(
            upcoming,
            key=lambda l: haversine_distance(ambulance_location, l.coordinates)
        )
        eta_to_next = calculate_eta_to_junction(
            ambulance_location,
            ambulance_speed,
            closest_upcoming.coordinates
        )
    
    return GreenCorridorStatus(
        ambulance_id=ambulance_id,
        active_lights=active_light_ids,
        upcoming_lights=upcoming_light_ids,
        eta_to_next_junction=eta_to_next
    )


def deactivate_junction(
    light: TrafficLight,
    gradual: bool = True
) -> None:
    """
    Deactivate emergency mode for a junction.
    
    Args:
        light: Traffic light to deactivate
        gradual: If True, transition through yellow before returning to normal
    """
    if light.mode == TrafficLightMode.EMERGENCY:
        if gradual:
            # Gradual recovery: Green -> Yellow -> Normal cycle
            light.current_state = SignalState.YELLOW
        else:
            # Immediate return to normal
            light.current_state = SignalState.RED
        
        light.mode = TrafficLightMode.NORMAL
        light.controlled_by_ambulance = None
        light.last_state_change = datetime.now(timezone.utc)


def check_and_deactivate_passed_junctions(
    ambulance_id: str,
    ambulance_location: Coordinates,
    all_lights: List[TrafficLight],
    deactivation_distance: float = 150  # meters
) -> List[str]:
    """
    Check if ambulance has passed junctions and deactivate them.
    
    Returns:
        List of deactivated junction IDs
    """
    deactivated = []
    
    for light in all_lights:
        if light.controlled_by_ambulance == ambulance_id:
            distance_km = haversine_distance(ambulance_location, light.coordinates)
            distance_m = distance_km * 1000
            
            # If ambulance is now far enough past the junction
            if distance_m > deactivation_distance:
                # Check if enough time has passed since activation
                if light.activated_at:
                    time_since_activation = (datetime.now(timezone.utc) - light.activated_at).total_seconds()
                    if time_since_activation > 10:  # At least 10 seconds
                        deactivate_junction(light, gradual=True)
                        deactivated.append(light.id)
    
    return deactivated


def manual_override_signal(
    light: TrafficLight,
    new_state: SignalState,
    duration_seconds: Optional[int] = None
) -> None:
    """
    Manually override a traffic signal (for police control).
    
    Args:
        light: Traffic light to control
        new_state: Desired signal state
        duration_seconds: Optional duration for manual control
    """
    light.current_state = new_state
    light.mode = TrafficLightMode.MANUAL
    light.last_state_change = datetime.now(timezone.utc)
    # Could implement timer-based auto-return to normal if duration is specified
