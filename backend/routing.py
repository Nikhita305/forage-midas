import math
import random
from typing import List, Tuple
from models import Coordinates, Route, RoutePoint, Hospital


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


def generate_route_points(start: Coordinates, end: Coordinates, num_points: int = 10) -> List[RoutePoint]:
    """Generate intermediate points for a route with turn instructions."""
    points = [RoutePoint(lat=start.lat, lng=start.lng, instruction="Start route")]
    
    directions = ["Continue straight", "Turn left", "Turn right", "Slight left", "Slight right", "Continue on current road"]
    
    for i in range(1, num_points - 1):
        t = i / (num_points - 1)
        lat = start.lat + t * (end.lat - start.lat) + random.uniform(-0.002, 0.002)
        lng = start.lng + t * (end.lng - start.lng) + random.uniform(-0.002, 0.002)
        instruction = random.choice(directions) if random.random() > 0.5 else ""
        points.append(RoutePoint(lat=lat, lng=lng, instruction=instruction))
    
    points.append(RoutePoint(lat=end.lat, lng=end.lng, instruction="Arrive at destination"))
    return points


def calculate_eta(distance_km: float, is_emergency: bool = True, traffic_level: int = 1) -> Tuple[int, int]:
    """Calculate ETA in minutes based on distance and conditions."""
    base_speed = 70 if is_emergency else 45  # km/h - emergency vehicles faster
    traffic_factor = 1 + (traffic_level - 1) * 0.25  # Traffic delay factor
    
    adjusted_speed = base_speed / traffic_factor
    duration_minutes = int((distance_km / adjusted_speed) * 60)
    traffic_delay = int(duration_minutes * (traffic_factor - 1))
    
    return max(1, duration_minutes), traffic_delay


def get_traffic_warnings(traffic_level: int) -> List[str]:
    """Generate traffic warnings based on traffic level."""
    warnings = []
    if traffic_level >= 2:
        warnings.append("Moderate traffic ahead")
    if traffic_level >= 3:
        warnings.append("Heavy congestion detected - consider alternate route")
    if traffic_level >= 4:
        warnings.append("⚠️ Severe traffic - significant delays expected")
    if traffic_level >= 5:
        warnings.append("🚨 Road incident reported - emergency reroute recommended")
    return warnings


def compute_route(start: Coordinates, end: Coordinates, traffic_level: int = 1, is_emergency: bool = True) -> Route:
    """Compute a route between two points with full details."""
    distance = haversine_distance(start, end)
    duration, traffic_delay = calculate_eta(distance, is_emergency, traffic_level)
    points = generate_route_points(start, end)
    warnings = get_traffic_warnings(traffic_level)
    
    # Determine next turn from the first few points
    next_turn = "Head towards destination"
    for p in points[1:4]:
        if p.instruction and p.instruction not in ["", "Continue straight"]:
            next_turn = p.instruction
            break
    
    return Route(
        points=points,
        distance_km=round(distance, 2),
        duration_minutes=duration + traffic_delay,
        traffic_delay_minutes=traffic_delay,
        next_turn=next_turn,
        traffic_warnings=warnings
    )


def compute_backup_route(start: Coordinates, end: Coordinates, traffic_level: int = 1) -> Route:
    """Compute an alternative backup route."""
    # Create a slightly different path via a midpoint offset
    midpoint = Coordinates(
        lat=start.lat + (end.lat - start.lat) * 0.5 + random.uniform(0.008, 0.015),
        lng=start.lng + (end.lng - start.lng) * 0.5 + random.uniform(0.008, 0.015)
    )
    
    # Calculate total distance via midpoint
    distance = haversine_distance(start, midpoint) + haversine_distance(midpoint, end)
    
    # Backup route usually has less traffic (different roads)
    adjusted_traffic = max(1, traffic_level - 1)
    duration, traffic_delay = calculate_eta(distance, True, adjusted_traffic)
    
    # Generate points via midpoint
    points_to_mid = generate_route_points(start, midpoint, 5)
    points_to_end = generate_route_points(midpoint, end, 5)[1:]  # Skip duplicate midpoint
    all_points = points_to_mid + points_to_end
    
    warnings = get_traffic_warnings(adjusted_traffic)
    
    return Route(
        points=all_points,
        distance_km=round(distance, 2),
        duration_minutes=duration + traffic_delay,
        traffic_delay_minutes=traffic_delay,
        next_turn="Take alternate route via side roads",
        traffic_warnings=warnings
    )


def rank_hospitals_by_eta(ambulance_location: Coordinates, hospitals: List[dict], traffic_level: int = 1) -> List[dict]:
    """Rank hospitals by ETA from ambulance location."""
    ranked = []
    
    for hospital in hospitals:
        h_coords = Coordinates(lat=hospital['coordinates']['lat'], lng=hospital['coordinates']['lng'])
        distance = haversine_distance(ambulance_location, h_coords)
        eta, _ = calculate_eta(distance, is_emergency=True, traffic_level=traffic_level)
        
        hospital_copy = hospital.copy()
        hospital_copy['eta_minutes'] = eta
        hospital_copy['distance_km'] = round(distance, 2)
        ranked.append(hospital_copy)
    
    return sorted(ranked, key=lambda x: x['eta_minutes'])
