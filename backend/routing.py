import math
import random
from typing import List, Tuple
from models import Coordinates, Hospital


def haversine_distance(coord1: Coordinates, coord2: Coordinates) -> float:
    """Calculate distance between two coordinates in km."""
    R = 6371  # Earth's radius in km
    
    lat1, lon1 = math.radians(coord1.lat), math.radians(coord1.lng)
    lat2, lon2 = math.radians(coord2.lat), math.radians(coord2.lng)
    
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    
    a = math.sin(dlat/2)**2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon/2)**2
    c = 2 * math.asin(math.sqrt(a))
    
    return R * c


def calculate_eta(distance_km: float, is_emergency: bool = True) -> int:
    """Calculate ETA in minutes."""
    base_speed = 60 if is_emergency else 40  # km/h
    duration_minutes = int((distance_km / base_speed) * 60)
    return max(1, duration_minutes)


def rank_hospitals_by_eta(ambulance_location: Coordinates, hospitals: List[dict]) -> List[dict]:
    """Rank hospitals by ETA from ambulance location."""
    ranked = []
    
    for hospital in hospitals:
        h_coords = Coordinates(lat=hospital['coordinates']['lat'], lng=hospital['coordinates']['lng'])
        distance = haversine_distance(ambulance_location, h_coords)
        eta = calculate_eta(distance, is_emergency=True)
        
        hospital_copy = hospital.copy()
        hospital_copy['eta_minutes'] = eta
        hospital_copy['distance_km'] = round(distance, 2)
        ranked.append(hospital_copy)
    
    return sorted(ranked, key=lambda x: x['eta_minutes'])


def calculate_distance_to_traffic_point(ambulance_location: Coordinates) -> float:
    """Calculate approximate distance to nearest traffic point (simulated)."""
    # Simulate distance to a traffic control point
    base_distance = random.uniform(0.3, 2.0)  # 300m to 2km
    return round(base_distance, 2)


def get_direction_of_travel(speed: float, heading: float = 0) -> str:
    """Get direction description based on heading."""
    if speed < 5:
        return "Stationary"
    
    directions = ["North", "Northeast", "East", "Southeast", "South", "Southwest", "West", "Northwest"]
    index = int((heading + 22.5) / 45) % 8
    return f"Heading {directions[index]}"
