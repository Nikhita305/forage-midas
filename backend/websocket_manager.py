from typing import Dict, Set, List
from fastapi import WebSocket
import json
from datetime import datetime, timezone


class ConnectionManager:
    def __init__(self):
        self.driver_connections: Dict[str, WebSocket] = {}
        self.police_connections: Dict[str, WebSocket] = {}
        self.alert_history: List[dict] = []
    
    async def connect_driver(self, websocket: WebSocket, driver_id: str):
        await websocket.accept()
        self.driver_connections[driver_id] = websocket
        print(f"Driver {driver_id} connected. Total drivers: {len(self.driver_connections)}")
    
    async def connect_police(self, websocket: WebSocket, police_id: str):
        await websocket.accept()
        self.police_connections[police_id] = websocket
        print(f"Police {police_id} connected. Total police: {len(self.police_connections)}")
    
    def disconnect_driver(self, driver_id: str):
        self.driver_connections.pop(driver_id, None)
        print(f"Driver {driver_id} disconnected")
    
    def disconnect_police(self, police_id: str):
        self.police_connections.pop(police_id, None)
        print(f"Police {police_id} disconnected")
    
    async def send_to_driver(self, driver_id: str, message: dict):
        """Send message to a specific driver."""
        websocket = self.driver_connections.get(driver_id)
        if websocket:
            try:
                await websocket.send_json(message)
                return True
            except Exception as e:
                print(f"Error sending to driver {driver_id}: {e}")
                self.driver_connections.pop(driver_id, None)
        return False
    
    async def send_to_police(self, police_id: str, message: dict):
        """Send message to a specific police officer."""
        websocket = self.police_connections.get(police_id)
        if websocket:
            try:
                await websocket.send_json(message)
                return True
            except Exception as e:
                print(f"Error sending to police {police_id}: {e}")
                self.police_connections.pop(police_id, None)
        return False
    
    async def broadcast_to_all_police(self, message: dict):
        """Broadcast alert to ALL logged-in traffic police officers."""
        message['timestamp'] = datetime.now(timezone.utc).isoformat()
        
        # Store in history
        self.alert_history.append(message)
        if len(self.alert_history) > 100:
            self.alert_history = self.alert_history[-100:]
        
        recipients = 0
        disconnected = []
        
        for police_id, websocket in self.police_connections.items():
            try:
                await websocket.send_json(message)
                recipients += 1
            except Exception as e:
                print(f"Error broadcasting to police {police_id}: {e}")
                disconnected.append(police_id)
        
        for pid in disconnected:
            self.police_connections.pop(pid, None)
        
        print(f"Alert broadcast to {recipients} police officers")
        return recipients
    
    async def send_alert_to_police(self, alert_data: dict):
        """Send emergency alert to all traffic police."""
        message = {
            "type": "emergency_alert",
            "data": alert_data
        }
        return await self.broadcast_to_all_police(message)
    
    async def send_status_update_to_driver(self, driver_id: str, status_type: str, data: dict):
        """Send acknowledgment or route cleared status to driver."""
        message = {
            "type": status_type,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "data": data
        }
        return await self.send_to_driver(driver_id, message)
    
    async def send_ambulance_location_update(self, location_data: dict):
        """Send ambulance location update to all police."""
        message = {
            "type": "ambulance_location",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "data": location_data
        }
        return await self.broadcast_to_all_police(message)
    
    def get_recent_alerts(self, limit: int = 20) -> List[dict]:
        """Get recent alert history."""
        return self.alert_history[-limit:]
    
    def get_connected_police_count(self) -> int:
        return len(self.police_connections)
    
    def get_connected_driver_count(self) -> int:
        return len(self.driver_connections)


manager = ConnectionManager()
