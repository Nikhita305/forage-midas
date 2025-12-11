import math
import random
from typing import List, Tuple
from models import Coordinates, Route, RoutePoint, Hospital, TrafficZone, CongestionLevel


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


def get_congestion_level(severity: int) -> CongestionLevel:
    """Convert severity (1-5) to CongestionLevel."""
    if severity <= 1:
        return CongestionLevel.LOW
    elif severity == 2:
        return CongestionLevel.MODERATE
    elif severity == 3:
        return CongestionLevel.HIGH
    else:
        return CongestionLevel.SEVERE


def get_congestion_factor(level: CongestionLevel) -> float:
    """Get speed reduction factor based on congestion."""
    factors = {
        CongestionLevel.LOW: 1.0,
        CongestionLevel.MODERATE: 1.3,
        CongestionLevel.HIGH: 1.7,
        CongestionLevel.SEVERE: 2.5
    }
    return factors.get(level, 1.0)


def generate_route_points(start: Coordinates, end: Coordinates, traffic_zones: List[TrafficZone], num_points: int = 12) -> List[RoutePoint]:
    """Generate route points with congestion info."""
    points = [RoutePoint(lat=start.lat, lng=start.lng, instruction="Start navigation", congestion=CongestionLevel.LOW)]
    
    directions = [
        "Continue straight for 500m",
        "Turn left ahead",
        "Turn right ahead", 
        "Slight left",
        "Slight right",
        "Continue on main road",
        "Merge onto highway",
        "Take exit"
    ]
    
    for i in range(1, num_points - 1):
        t = i / (num_points - 1)
        lat = start.lat + t * (end.lat - start.lat) + random.uniform(-0.003, 0.003)
        lng = start.lng + t * (end.lng - start.lng) + random.uniform(-0.003, 0.003)
        
        # Check if point is in a traffic zone
        point_coord = Coordinates(lat=lat, lng=lng)
        congestion = CongestionLevel.LOW
        for zone in traffic_zones:
            if haversine_distance(point_coord, zone.location) < zone.radius_km:
                congestion = zone.congestion_level
                break
        
        instruction = random.choice(directions) if random.random() > 0.6 else ""
        points.append(RoutePoint(lat=lat, lng=lng, instruction=instruction, congestion=congestion))
    
    points.append(RoutePoint(lat=end.lat, lng=end.lng, instruction="Arrive at destination", congestion=CongestionLevel.LOW))
    return points


def calculate_eta(distance_km: float, is_emergency: bool, congestion: CongestionLevel) -> Tuple[int, int]:
    """Calculate ETA considering traffic."""
    base_speed = 70 if is_emergency else 45  # km/h
    congestion_factor = get_congestion_factor(congestion)
    
    adjusted_speed = base_speed / congestion_factor
    duration_minutes = int((distance_km / adjusted_speed) * 60)
    traffic_delay = int(duration_minutes * (congestion_factor - 1))
    
    return max(1, duration_minutes), traffic_delay


def get_traffic_warnings(congestion: CongestionLevel, traffic_zones: List[TrafficZone]) -> Tuple[List[str], List[str]]:
    """Generate traffic warnings and blocked roads."""
    warnings = []
    blocked = []
    
    if congestion == CongestionLevel.MODERATE:
        warnings.append("⚠️ Moderate traffic ahead - minor delays expected")
    elif congestion == CongestionLevel.HIGH:
        warnings.append("🚧 Heavy traffic - consider alternate route")
        warnings.append("Estimated delay: 5-10 minutes")
    elif congestion == CongestionLevel.SEVERE:
        warnings.append("🚨 SEVERE CONGESTION - Major delays")
        warnings.append("Automatic alert sent to traffic authorities")
        warnings.append("Estimated delay: 15+ minutes")
    
    for zone in traffic_zones:
        if zone.blocked:
            blocked.append(f"Road blocked near {zone.description}")
        if zone.incident_type == "accident":
            warnings.append(f"🚗 Accident reported: {zone.description}")
        elif zone.incident_type == "construction":
            warnings.append(f"🔧 Construction zone: {zone.description}")
    
    return warnings, blocked


def compute_route(start: Coordinates, end: Coordinates, traffic_zones: List[TrafficZone], is_emergency: bool = True) -> Route:
    """Compute optimal route considering traffic."""
    distance = haversine_distance(start, end)
    
    # Determine overall congestion level
    max_congestion = CongestionLevel.LOW
    for zone in traffic_zones:
        if haversine_distance(start, zone.location) < 3 or haversine_distance(end, zone.location) < 3:
            if get_congestion_factor(zone.congestion_level) > get_congestion_factor(max_congestion):
                max_congestion = zone.congestion_level
    
    duration, traffic_delay = calculate_eta(distance, is_emergency, max_congestion)
    points = generate_route_points(start, end, traffic_zones)
    warnings, blocked = get_traffic_warnings(max_congestion, traffic_zones)
    
    # Determine next turn
    next_turn = "Head towards destination"
    for p in points[1:4]:
        if p.instruction and "turn" in p.instruction.lower():
            next_turn = p.instruction
            break
    
    return Route(
        points=points,
        distance_km=round(distance, 2),
        duration_minutes=duration + traffic_delay,
        traffic_delay_minutes=traffic_delay,
        congestion_level=max_congestion,
        next_turn=next_turn,
        traffic_warnings=warnings,
        blocked_roads=blocked
    )


def compute_alternate_route(start: Coordinates, end: Coordinates, traffic_zones: List[TrafficZone]) -> Route:
    """Compute alternate route avoiding congestion."""
    # Create a detour via offset midpoint
    midpoint = Coordinates(
        lat=start.lat + (end.lat - start.lat) * 0.5 + random.uniform(0.01, 0.02),
        lng=start.lng + (end.lng - start.lng) * 0.5 + random.uniform(0.01, 0.02)
    )
    
    distance = haversine_distance(start, midpoint) + haversine_distance(midpoint, end)
    
    # Alternate route typically has less congestion
    reduced_zones = [z for z in traffic_zones if z.congestion_level != CongestionLevel.SEVERE]
    
    max_congestion = CongestionLevel.LOW
    for zone in reduced_zones:
        if haversine_distance(midpoint, zone.location) < 2:
            if get_congestion_factor(zone.congestion_level) > get_congestion_factor(max_congestion):
                max_congestion = zone.congestion_level
    
    # Cap at moderate for alternate route
    if max_congestion == CongestionLevel.SEVERE:
        max_congestion = CongestionLevel.HIGH
    
    duration, traffic_delay = calculate_eta(distance, True, max_congestion)
    
    points_to_mid = generate_route_points(start, midpoint, reduced_zones, 6)
    points_to_end = generate_route_points(midpoint, end, reduced_zones, 6)[1:]
    all_points = points_to_mid + points_to_end
    
    warnings, blocked = get_traffic_warnings(max_congestion, reduced_zones)
    
    return Route(
        points=all_points,
        distance_km=round(distance, 2),
        duration_minutes=duration + traffic_delay,
        traffic_delay_minutes=traffic_delay,
        congestion_level=max_congestion,
        next_turn="Take alternate route via side roads",
        traffic_warnings=warnings if warnings else ["Alternate route with less traffic"],
        blocked_roads=blocked
    )


def rank_hospitals_by_eta(ambulance_location: Coordinates, hospitals: List[dict], traffic_zones: List[TrafficZone]) -> List[dict]:
    """Rank hospitals by ETA considering traffic."""
    ranked = []
    
    for hospital in hospitals:
        h_coords = Coordinates(lat=hospital['coordinates']['lat'], lng=hospital['coordinates']['lng'])
        distance = haversine_distance(ambulance_location, h_coords)
        
        # Check traffic along the way
        max_congestion = CongestionLevel.LOW
        for zone in traffic_zones:
            mid_point = Coordinates(
                lat=(ambulance_location.lat + h_coords.lat) / 2,
                lng=(ambulance_location.lng + h_coords.lng) / 2
            )
            if haversine_distance(mid_point, zone.location) < zone.radius_km + 1:
                if get_congestion_factor(zone.congestion_level) > get_congestion_factor(max_congestion):
                    max_congestion = zone.congestion_level
        
        eta, _ = calculate_eta(distance, is_emergency=True, congestion=max_congestion)
        
        hospital_copy = hospital.copy()
        hospital_copy['eta_minutes'] = eta
        hospital_copy['distance_km'] = round(distance, 2)
        hospital_copy['congestion_level'] = max_congestion.value
        ranked.append(hospital_copy)
    
    return sorted(ranked, key=lambda x: x['eta_minutes'])


def generate_mock_traffic_zones(center: Coordinates) -> List[TrafficZone]:
    """Generate mock traffic zones around a location."""
    zones = [
        TrafficZone(
            location=Coordinates(lat=center.lat + 0.008, lng=center.lng - 0.005),
            radius_km=0.4,
            congestion_level=CongestionLevel.MODERATE,
            description="Downtown area - moderate traffic",
            incident_type=None
        ),
        TrafficZone(
            location=Coordinates(lat=center.lat - 0.005, lng=center.lng + 0.01),
            radius_km=0.3,
            congestion_level=CongestionLevel.HIGH,
            description="Main St intersection",
            incident_type="construction"
        ),
        TrafficZone(
            location=Coordinates(lat=center.lat + 0.015, lng=center.lng + 0.008),
            radius_km=0.5,
            congestion_level=CongestionLevel.SEVERE,
            description="Highway junction - accident reported",
            incident_type="accident",
            blocked=False
        ),
        TrafficZone(
            location=Coordinates(lat=center.lat - 0.012, lng=center.lng - 0.008),
            radius_km=0.2,
            congestion_level=CongestionLevel.LOW,
            description="Residential area",
            incident_type=None
        ),
    ]
    return zones
