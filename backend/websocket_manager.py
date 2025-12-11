from typing import Dict, Set
from fastapi import WebSocket
import json
import asyncio


class ConnectionManager:
    def __init__(self):
        self.driver_connections: Dict[str, WebSocket] = {}
        self.civilian_connections: Set[WebSocket] = set()
    
    async def connect_driver(self, websocket: WebSocket, driver_id: str):
        await websocket.accept()
        self.driver_connections[driver_id] = websocket
    
    async def connect_civilian(self, websocket: WebSocket):
        """Connect civilian app users who can receive traffic clearing alerts."""
        await websocket.accept()
        self.civilian_connections.add(websocket)
    
    def disconnect_driver(self, driver_id: str):
        self.driver_connections.pop(driver_id, None)
    
    def disconnect_civilian(self, websocket: WebSocket):
        self.civilian_connections.discard(websocket)
    
    async def send_to_driver(self, driver_id: str, message: dict):
        """Send message to a specific driver."""
        websocket = self.driver_connections.get(driver_id)
        if websocket:
            try:
                await websocket.send_json(message)
            except Exception:
                self.driver_connections.pop(driver_id, None)
    
    async def broadcast_traffic_alert(self, alert_data: dict):
        """Broadcast traffic clearing alert to civilian app users."""
        message = {
            "type": "traffic_clearing_alert",
            "data": alert_data
        }
        
        disconnected = []
        for websocket in self.civilian_connections:
            try:
                await websocket.send_json(message)
            except Exception:
                disconnected.append(websocket)
        
        for ws in disconnected:
            self.civilian_connections.discard(ws)
    
    async def send_route_update(self, driver_id: str, route_data: dict):
        """Send route update/recalculation to driver."""
        message = {
            "type": "route_update",
            "data": route_data
        }
        await self.send_to_driver(driver_id, message)
    
    async def send_traffic_warning(self, driver_id: str, warning: str):
        """Send traffic warning to driver."""
        message = {
            "type": "traffic_warning",
            "data": {"warning": warning}
        }
        await self.send_to_driver(driver_id, message)


manager = ConnectionManager()
