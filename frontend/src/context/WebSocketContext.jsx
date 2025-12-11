import React, { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react';
import { useAuth } from './AuthContext';

const WebSocketContext = createContext(null);

export const WebSocketProvider = ({ children }) => {
  const { user, token } = useAuth();
  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [ambulanceLocations, setAmbulanceLocations] = useState({});
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);

  const connect = useCallback(() => {
    if (!user || !token) return;

    const wsUrl = process.env.REACT_APP_BACKEND_URL.replace('https://', 'wss://').replace('http://', 'ws://');
    
    // Connect to appropriate endpoint based on role
    const endpoint = user.role === 'police' 
      ? `${wsUrl}/api/ws/police/${user.id}`
      : `${wsUrl}/api/ws/driver/${user.id}`;

    try {
      wsRef.current = new WebSocket(endpoint);

      wsRef.current.onopen = () => {
        setIsConnected(true);
        console.log(`WebSocket connected as ${user.role}`);
      };

      wsRef.current.onmessage = (event) => {
        const message = JSON.parse(event.data);
        setLastMessage(message);

        // Handle different message types
        if (message.type === 'emergency_alert') {
          // New alert received (for police)
          setAlerts(prev => [message.data, ...prev.slice(0, 49)]);
        } else if (message.type === 'ambulance_location') {
          // Location update (for police)
          setAmbulanceLocations(prev => ({
            ...prev,
            [message.data.ambulance_id]: message.data
          }));
        } else if (message.type === 'alert_status_change') {
          // Alert status changed
          setAlerts(prev => prev.map(a => 
            a.alert_id === message.data.alert_id 
              ? { ...a, status: message.data.new_status }
              : a
          ));
        } else if (message.type === 'alert_acknowledged' || message.type === 'route_cleared') {
          // Status update for driver
          setLastMessage(message);
        }
      };

      wsRef.current.onclose = () => {
        setIsConnected(false);
        console.log('WebSocket disconnected');
        reconnectTimeoutRef.current = setTimeout(connect, 3000);
      };

      wsRef.current.onerror = (error) => {
        console.error('WebSocket error:', error);
      };
    } catch (error) {
      console.error('WebSocket connection error:', error);
    }
  }, [user, token]);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect]);

  const sendMessage = useCallback((message) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  const sendLocationUpdate = useCallback((ambulanceId, lat, lng, speed = 0) => {
    sendMessage({
      type: 'location_update',
      data: { ambulance_id: ambulanceId, lat, lng, speed }
    });
  }, [sendMessage]);

  const clearAlerts = useCallback(() => {
    setAlerts([]);
  }, []);

  return (
    <WebSocketContext.Provider value={{
      isConnected,
      lastMessage,
      alerts,
      setAlerts,
      ambulanceLocations,
      sendMessage,
      sendLocationUpdate,
      clearAlerts
    }}>
      {children}
    </WebSocketContext.Provider>
  );
};

export const useWebSocket = () => {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocket must be used within a WebSocketProvider');
  }
  return context;
};
