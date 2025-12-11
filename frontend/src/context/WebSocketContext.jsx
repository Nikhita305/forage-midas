import React, { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react';
import { useAuth } from './AuthContext';

const WebSocketContext = createContext(null);

export const WebSocketProvider = ({ children }) => {
  const { user, token } = useAuth();
  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState(null);
  const [ambulances, setAmbulances] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);

  const connect = useCallback(() => {
    if (!user || !token) return;

    const wsUrl = process.env.REACT_APP_BACKEND_URL.replace('https://', 'wss://').replace('http://', 'ws://');
    const endpoint = user.role === 'driver' 
      ? `${wsUrl}/api/ws/driver/${user.id}`
      : `${wsUrl}/api/ws/dispatcher`;

    try {
      wsRef.current = new WebSocket(endpoint);

      wsRef.current.onopen = () => {
        setIsConnected(true);
        console.log('WebSocket connected');
      };

      wsRef.current.onmessage = (event) => {
        const message = JSON.parse(event.data);
        setLastMessage(message);

        if (message.type === 'ambulance_update') {
          setAmbulances(prev => {
            const index = prev.findIndex(a => a.id === message.data.id);
            if (index >= 0) {
              const updated = [...prev];
              updated[index] = message.data;
              return updated;
            }
            return [...prev, message.data];
          });
        } else if (message.type === 'emergency_alert') {
          setAlerts(prev => [message.data, ...prev.slice(0, 9)]);
        }
      };

      wsRef.current.onclose = () => {
        setIsConnected(false);
        console.log('WebSocket disconnected');
        // Reconnect after 3 seconds
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

  return (
    <WebSocketContext.Provider value={{
      isConnected,
      lastMessage,
      ambulances,
      setAmbulances,
      alerts,
      sendMessage,
      sendLocationUpdate
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
