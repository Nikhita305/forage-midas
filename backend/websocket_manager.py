from typing import Dict, Set
from fastapi import WebSocket
import json
import asyncio


class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}
        self.dispatcher_connections: Set[WebSocket] = set()
        self.driver_connections: Dict[str, WebSocket] = {}
    
    async def connect_dispatcher(self, websocket: WebSocket):
        await websocket.accept()
        self.dispatcher_connections.add(websocket)
    
    async def connect_driver(self, websocket: WebSocket, driver_id: str):
        await websocket.accept()
        self.driver_connections[driver_id] = websocket
    
    def disconnect_dispatcher(self, websocket: WebSocket):
        self.dispatcher_connections.discard(websocket)
    
    def disconnect_driver(self, driver_id: str):
        self.driver_connections.pop(driver_id, None)
    
    async def broadcast_to_dispatchers(self, message: dict):
        """Send message to all dispatcher connections."""
        disconnected = []
        for connection in self.dispatcher_connections:
            try:
                await connection.send_json(message)
            except Exception:
                disconnected.append(connection)
        
        for conn in disconnected:
            self.dispatcher_connections.discard(conn)
    
    async def send_to_driver(self, driver_id: str, message: dict):
        """Send message to a specific driver."""
        websocket = self.driver_connections.get(driver_id)
        if websocket:
            try:
                await websocket.send_json(message)
            except Exception:
                self.driver_connections.pop(driver_id, None)
    
    async def broadcast_ambulance_update(self, ambulance_data: dict):
        """Broadcast ambulance location update to all dispatchers."""
        message = {
            "type": "ambulance_update",
            "data": ambulance_data
        }
        await self.broadcast_to_dispatchers(message)
    
    async def send_route_update(self, driver_id: str, route_data: dict):
        """Send route update to a specific driver."""
        message = {
            "type": "route_update",
            "data": route_data
        }
        await self.send_to_driver(driver_id, message)
    
    async def broadcast_alert(self, alert_data: dict):
        """Broadcast emergency alert to all connections."""
        message = {
            "type": "emergency_alert",
            "data": alert_data
        }
        await self.broadcast_to_dispatchers(message)
        
        for driver_id, websocket in list(self.driver_connections.items()):
            try:
                await websocket.send_json(message)
            except Exception:
                self.driver_connections.pop(driver_id, None)


manager = ConnectionManager()
