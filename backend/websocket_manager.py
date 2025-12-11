from typing import Dict, Set, List
from fastapi import WebSocket
import json
import asyncio
from datetime import datetime, timezone


class ConnectionManager:
    def __init__(self):
        self.driver_connections: Dict[str, WebSocket] = {}
        self.traffic_alert_listeners: Set[WebSocket] = set()
        self.alert_history: List[dict] = []
    
    async def connect_driver(self, websocket: WebSocket, driver_id: str):
        await websocket.accept()
        self.driver_connections[driver_id] = websocket
    
    async def connect_traffic_listener(self, websocket: WebSocket):
        """Connect clients that want to receive traffic alerts (future: traffic police)."""
        await websocket.accept()
        self.traffic_alert_listeners.add(websocket)
    
    def disconnect_driver(self, driver_id: str):
        self.driver_connections.pop(driver_id, None)
    
    def disconnect_traffic_listener(self, websocket: WebSocket):
        self.traffic_alert_listeners.discard(websocket)
    
    async def send_to_driver(self, driver_id: str, message: dict):
        """Send message to a specific driver."""
        websocket = self.driver_connections.get(driver_id)
        if websocket:
            try:
                await websocket.send_json(message)
            except Exception:
                self.driver_connections.pop(driver_id, None)
    
    async def broadcast_traffic_alert(self, alert_data: dict):
        """
        Broadcast traffic alert to all listeners.
        This simulates sending alerts to traffic police/management systems.
        """
        message = {
            "type": "traffic_alert",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "data": alert_data
        }
        
        # Store in history
        self.alert_history.append(message)
        if len(self.alert_history) > 100:
            self.alert_history = self.alert_history[-100:]
        
        # Broadcast to all traffic listeners
        disconnected = []
        for websocket in self.traffic_alert_listeners:
            try:
                await websocket.send_json(message)
            except Exception:
                disconnected.append(websocket)
        
        for ws in disconnected:
            self.traffic_alert_listeners.discard(ws)
        
        # Also send to all drivers (for awareness)
        for driver_id, ws in list(self.driver_connections.items()):
            try:
                await ws.send_json(message)
            except Exception:
                self.driver_connections.pop(driver_id, None)
        
        return len(self.traffic_alert_listeners) + len(self.driver_connections)
    
    async def send_route_update(self, driver_id: str, route_data: dict):
        """Send route update to driver."""
        message = {
            "type": "route_update",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "data": route_data
        }
        await self.send_to_driver(driver_id, message)
    
    async def send_traffic_warning(self, driver_id: str, warning: str, congestion_level: str):
        """Send traffic warning to driver."""
        message = {
            "type": "traffic_warning",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "data": {
                "warning": warning,
                "congestion_level": congestion_level
            }
        }
        await self.send_to_driver(driver_id, message)
    
    async def send_emergency_alert(self, alert_data: dict):
        """
        Send emergency approach alert.
        Message: "Ambulance approaching — clear path"
        """
        message = {
            "type": "emergency_approach",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "priority": "HIGH",
            "data": {
                **alert_data,
                "action_required": "Clear path for approaching ambulance"
            }
        }
        
        self.alert_history.append(message)
        
        # Broadcast to all
        recipients = 0
        for websocket in self.traffic_alert_listeners:
            try:
                await websocket.send_json(message)
                recipients += 1
            except Exception:
                pass
        
        return recipients
    
    def get_recent_alerts(self, limit: int = 20) -> List[dict]:
        """Get recent alert history."""
        return self.alert_history[-limit:]


manager = ConnectionManager()
