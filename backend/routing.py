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
    """Generate intermediate points for a route with slight variations."""
    points = [RoutePoint(lat=start.lat, lng=start.lng)]
    
    for i in range(1, num_points - 1):
        t = i / (num_points - 1)
        lat = start.lat + t * (end.lat - start.lat) + random.uniform(-0.002, 0.002)
        lng = start.lng + t * (end.lng - start.lng) + random.uniform(-0.002, 0.002)
        points.append(RoutePoint(lat=lat, lng=lng))
    
    points.append(RoutePoint(lat=end.lat, lng=end.lng))
    return points


def calculate_eta(distance_km: float, is_emergency: bool = True, traffic_level: int = 1) -> Tuple[int, int]:
    """Calculate ETA in minutes based on distance and conditions."""
    base_speed = 60 if is_emergency else 40  # km/h
    traffic_factor = 1 + (traffic_level - 1) * 0.2  # Traffic delay factor
    
    adjusted_speed = base_speed / traffic_factor
    duration_minutes = int((distance_km / adjusted_speed) * 60)
    traffic_delay = int(duration_minutes * (traffic_factor - 1))
    
    return duration_minutes, traffic_delay


def compute_route(start: Coordinates, end: Coordinates, traffic_level: int = 1, is_emergency: bool = True) -> Route:
    """Compute a route between two points."""
    distance = haversine_distance(start, end)
    duration, traffic_delay = calculate_eta(distance, is_emergency, traffic_level)
    points = generate_route_points(start, end)
    
    return Route(
        points=points,
        distance_km=round(distance, 2),
        duration_minutes=duration,
        traffic_delay_minutes=traffic_delay
    )


def compute_alternative_routes(start: Coordinates, end: Coordinates, traffic_level: int = 1) -> List[Route]:
    """Compute 2 alternative routes with different characteristics."""
    routes = []
    
    # Alternative 1: Longer but potentially faster (avoiding traffic)
    midpoint1 = Coordinates(
        lat=start.lat + (end.lat - start.lat) * 0.5 + 0.01,
        lng=start.lng + (end.lng - start.lng) * 0.5 + 0.01
    )
    points1 = generate_route_points(start, midpoint1, 5) + generate_route_points(midpoint1, end, 5)[1:]
    distance1 = haversine_distance(start, midpoint1) + haversine_distance(midpoint1, end)
    duration1, delay1 = calculate_eta(distance1, True, max(1, traffic_level - 1))
    
    routes.append(Route(
        points=points1,
        distance_km=round(distance1, 2),
        duration_minutes=duration1,
        traffic_delay_minutes=delay1
    ))
    
    # Alternative 2: Different path
    midpoint2 = Coordinates(
        lat=start.lat + (end.lat - start.lat) * 0.5 - 0.01,
        lng=start.lng + (end.lng - start.lng) * 0.5 - 0.01
    )
    points2 = generate_route_points(start, midpoint2, 5) + generate_route_points(midpoint2, end, 5)[1:]
    distance2 = haversine_distance(start, midpoint2) + haversine_distance(midpoint2, end)
    duration2, delay2 = calculate_eta(distance2, True, traffic_level)
    
    routes.append(Route(
        points=points2,
        distance_km=round(distance2, 2),
        duration_minutes=duration2,
        traffic_delay_minutes=delay2
    ))
    
    return routes


def rank_hospitals(ambulance_location: Coordinates, hospitals: List[dict], required_specialty: str = None) -> List[dict]:
    """Rank hospitals by ETA and specialty match."""
    ranked = []
    
    for hospital in hospitals:
        h_coords = Coordinates(lat=hospital['coordinates']['lat'], lng=hospital['coordinates']['lng'])
        distance = haversine_distance(ambulance_location, h_coords)
        eta, _ = calculate_eta(distance, is_emergency=True)
        
        hospital_copy = hospital.copy()
        hospital_copy['eta_minutes'] = eta
        hospital_copy['distance_km'] = round(distance, 2)
        
        # Score calculation
        score = eta  # Base score is ETA
        if required_specialty and required_specialty in hospital.get('specialties', []):
            score -= 10  # Bonus for matching specialty
        if hospital.get('availability', 0) < 5:
            score += 15  # Penalty for low availability
            
        hospital_copy['score'] = score
        ranked.append(hospital_copy)
    
    return sorted(ranked, key=lambda x: x['score'])
