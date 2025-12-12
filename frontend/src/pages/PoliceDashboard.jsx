import React, { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { useWebSocket } from '../context/WebSocketContext';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { ScrollArea } from '../components/ui/scroll-area';
import { 
  Shield, Ambulance, LogOut, Radio, Bell, CheckCircle, 
  Navigation, MapPin, Clock, AlertTriangle, Volume2
} from 'lucide-react';
import { Toaster, toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// Ambulance icon for police view
const ambulanceIcon = L.divIcon({
  className: 'custom-ambulance-icon',
  html: `<div style="background: #ef4444; border-radius: 50%; width: 48px; height: 48px; display: flex; align-items: center; justify-content: center; border: 4px solid white; box-shadow: 0 0 30px rgba(239,68,68,0.8); animation: pulse 1.5s infinite;">
    <svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M10 10H6"/><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.28a1 1 0 0 0-.684-.948l-1.923-.641a1 1 0 0 1-.578-.502l-1.539-3.076A1 1 0 0 0 16.382 8H14"/><path d="M8 8v4"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/></svg>
  </div>`,
  iconSize: [48, 48],
  iconAnchor: [24, 24],
});

// Map center updater
const MapCenterUpdater = ({ center }) => {
  const map = useMap();
  useEffect(() => {
    if (center) {
      map.flyTo(center, 15, { duration: 1 });
    }
  }, [center, map]);
  return null;
};

const PoliceDashboard = () => {
  const { user, logout } = useAuth();
  const { isConnected, alerts, setAlerts, ambulanceLocations } = useWebSocket();
  
  const [liveAlerts, setLiveAlerts] = useState([]);
  const [selectedAlert, setSelectedAlert] = useState(null);
  const [mapCenter, setMapCenter] = useState([40.7128, -74.0060]);
  const [isAcknowledging, setIsAcknowledging] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  // Fetch initial alerts
  useEffect(() => {
    fetchLiveAlerts();
  }, []);

  // Update alerts from WebSocket
  useEffect(() => {
    if (alerts.length > 0) {
      setLiveAlerts(prev => {
        const newAlerts = [...alerts];
        // Merge with existing, avoiding duplicates
        const existingIds = new Set(prev.map(a => a.alert_id));
        const uniqueNew = newAlerts.filter(a => !existingIds.has(a.alert_id));
        return [...uniqueNew, ...prev].slice(0, 50);
      });
      
      // Play sound and show toast for new alerts
      const latestAlert = alerts[0];
      if (latestAlert && latestAlert.status === 'active') {
        playAlertSound();
        toast.error(
          <div className="space-y-1">
            <strong className="text-base">🚨 EMERGENCY ALERT</strong>
            <div className="font-semibold">{latestAlert.ambulance_call_sign}</div>
            {latestAlert.vehicle_number && (
              <div className="font-mono text-sm bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded inline-block">
                {latestAlert.vehicle_number}
              </div>
            )}
            <p className="text-sm">{latestAlert.driver_name}</p>
            <p className="text-sm font-semibold mt-1">📍 {latestAlert.distance_to_traffic_point_m}m away</p>
          </div>,
          { duration: 10000 }
        );
        
        // Center map on alert
        if (latestAlert.location) {
          setMapCenter([latestAlert.location.lat, latestAlert.location.lng]);
          setSelectedAlert(latestAlert);
        }
      }
    }
  }, [alerts]);

  // Update map when ambulance location changes
  useEffect(() => {
    if (selectedAlert && ambulanceLocations[selectedAlert.ambulance_id]) {
      const loc = ambulanceLocations[selectedAlert.ambulance_id];
      setMapCenter([loc.location.lat, loc.location.lng]);
    }
  }, [ambulanceLocations, selectedAlert]);

  const fetchLiveAlerts = async () => {
    try {
      const response = await axios.get(`${API}/alerts/live`);
      setLiveAlerts(response.data);
      
      // Select most recent active alert
      const activeAlert = response.data.find(a => a.status === 'active');
      if (activeAlert) {
        setSelectedAlert(activeAlert);
        setMapCenter([activeAlert.location.lat, activeAlert.location.lng]);
      }
    } catch (error) {
      console.error('Failed to fetch alerts:', error);
    }
  };

  const playAlertSound = () => {
    // Create a simple beep sound
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      
      oscillator.frequency.value = 800;
      oscillator.type = 'sine';
      gainNode.gain.value = 0.3;
      
      oscillator.start();
      setTimeout(() => oscillator.stop(), 500);
    } catch (e) {
      console.log('Could not play alert sound');
    }
  };

  const acknowledgeAlert = async (alertId) => {
    setIsAcknowledging(true);
    try {
      await axios.post(`${API}/alert/acknowledge`, { alert_id: alertId });
      
      // Update local state
      setLiveAlerts(prev => prev.map(a => 
        a.id === alertId ? { ...a, status: 'acknowledged' } : a
      ));
      
      toast.success('Alert acknowledged - Driver notified');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to acknowledge');
    } finally {
      setIsAcknowledging(false);
    }
  };

  const clearRoute = async (alertId) => {
    setIsClearing(true);
    try {
      await axios.post(`${API}/alert/clear`, { 
        alert_id: alertId,
        message: "Route cleared - proceed safely"
      });
      
      // Update local state
      setLiveAlerts(prev => prev.map(a => 
        a.id === alertId ? { ...a, status: 'cleared' } : a
      ));
      
      if (selectedAlert?.id === alertId) {
        setSelectedAlert(null);
      }
      
      toast.success('Route marked as cleared - Driver notified');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to clear route');
    } finally {
      setIsClearing(false);
    }
  };

  const getAlertStatusBadge = (status) => {
    switch (status) {
      case 'active':
        return <Badge className="bg-red-500 text-white animate-pulse">ACTIVE</Badge>;
      case 'acknowledged':
        return <Badge className="bg-amber-500 text-white">ACKNOWLEDGED</Badge>;
      case 'cleared':
        return <Badge className="bg-green-500 text-white">CLEARED</Badge>;
      default:
        return <Badge variant="secondary">{status?.toUpperCase()}</Badge>;
    }
  };

  const formatTime = (dateStr) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const activeAlerts = liveAlerts.filter(a => a.status === 'active');
  const acknowledgedAlerts = liveAlerts.filter(a => a.status === 'acknowledged');

  // Get current ambulance location (from WebSocket or alert)
  const getCurrentAmbulanceLocation = () => {
    if (selectedAlert) {
      const wsLoc = ambulanceLocations[selectedAlert.ambulance_id];
      if (wsLoc) return wsLoc.location;
      return selectedAlert.location;
    }
    return null;
  };

  const ambulanceLoc = getCurrentAmbulanceLocation();

  return (
    <div className="h-screen flex flex-col bg-zinc-950">
      <Toaster position="top-right" richColors />
      
      {/* Header */}
      <header className="h-16 bg-zinc-900 border-b border-zinc-800 px-4 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-blue-500 flex items-center justify-center">
            <Shield className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-zinc-100">Traffic Police</h1>
            <p className="text-xs text-zinc-500">{user?.name}</p>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          {activeAlerts.length > 0 && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded bg-red-500/20 text-red-400 text-sm font-medium animate-pulse">
              <Bell className="w-4 h-4" />
              {activeAlerts.length} Active Alert{activeAlerts.length !== 1 ? 's' : ''}
            </div>
          )}
          
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs font-medium ${isConnected ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
            <Radio className="w-3 h-3" />
            {isConnected ? 'LIVE' : 'OFFLINE'}
          </div>
          
          <Button variant="ghost" size="sm" onClick={logout} data-testid="logout-btn" className="text-zinc-400 hover:text-zinc-100">
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Left - Alerts List */}
        <div className="w-96 bg-zinc-900 border-r border-zinc-800 flex flex-col">
          <div className="p-4 border-b border-zinc-800">
            <h2 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
              <Bell className="w-4 h-4 text-red-500" />
              Incoming Alerts
            </h2>
            <p className="text-xs text-zinc-500 mt-1">Active alerts shown first</p>
          </div>
          
          <ScrollArea className="flex-1">
            <div className="p-3 space-y-3">
              {liveAlerts.length === 0 ? (
                <div className="text-center py-8 text-zinc-500">
                  <Bell className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p>No alerts yet</p>
                  <p className="text-sm">Alerts from ambulance drivers will appear here</p>
                </div>
              ) : (
                liveAlerts.map(alert => (
                  <Card 
                    key={alert.id || alert.alert_id}
                    className={`cursor-pointer transition-all ${
                      selectedAlert?.id === alert.id || selectedAlert?.alert_id === alert.alert_id
                        ? 'border-blue-500 ring-1 ring-blue-500/20'
                        : alert.status === 'active'
                        ? 'border-red-500/50 bg-red-500/5'
                        : 'border-zinc-700'
                    } bg-zinc-800`}
                    onClick={() => {
                      setSelectedAlert(alert);
                      if (alert.location) {
                        setMapCenter([alert.location.lat, alert.location.lng]);
                      }
                    }}
                    data-testid={`alert-card-${alert.id || alert.alert_id}`}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <Ambulance className="w-5 h-5 text-red-500" />
                            <span className="font-bold text-zinc-100">
                              {alert.ambulance_call_sign}
                            </span>
                          </div>
                          {alert.vehicle_number && (
                            <div className="font-mono text-sm font-semibold text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded inline-block">
                              {alert.vehicle_number}
                            </div>
                          )}
                        </div>
                        {getAlertStatusBadge(alert.status)}
                      </div>
                      
                      {/* Vehicle & Driver Details */}
                      <div className="bg-zinc-900/50 rounded-lg p-3 mb-3 space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-zinc-500">Driver:</span>
                          <span className="text-zinc-200 font-medium">{alert.driver_name}</span>
                        </div>
                        {alert.driver_phone && (
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-zinc-500">Contact:</span>
                            <span className="text-blue-400 font-mono">{alert.driver_phone}</span>
                          </div>
                        )}
                        {alert.vehicle_type && (
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-zinc-500">Type:</span>
                            <span className="text-zinc-300">{alert.vehicle_type}</span>
                          </div>
                        )}
                      </div>
                      
                      {/* Location & Status Info */}
                      <div className="space-y-1.5 text-xs">
                        <div className="flex items-center gap-2 text-amber-400 font-semibold">
                          <MapPin className="w-3.5 h-3.5" />
                          <span>
                            {alert.distance_to_traffic_point_m || Math.round(alert.distance_to_traffic_point_km * 1000)}m away
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-zinc-400">
                          <Clock className="w-3 h-3" />
                          <span>{formatTime(alert.created_at)}</span>
                        </div>
                        {alert.speed > 0 && (
                          <div className="flex items-center gap-2 text-zinc-400">
                            <Navigation className="w-3 h-3" />
                            <span>{Math.round(alert.speed)} km/h • {alert.direction}</span>
                          </div>
                        )}
                      </div>
                      
                      {/* Action Buttons */}
                      {alert.status === 'active' && (
                        <div className="flex gap-2 mt-3">
                          <Button 
                            size="sm" 
                            className="flex-1 bg-amber-500 hover:bg-amber-600 text-white"
                            onClick={(e) => { e.stopPropagation(); acknowledgeAlert(alert.id || alert.alert_id); }}
                            disabled={isAcknowledging}
                            data-testid={`acknowledge-btn-${alert.id || alert.alert_id}`}
                          >
                            <CheckCircle className="w-4 h-4 mr-1" />
                            Acknowledge
                          </Button>
                        </div>
                      )}
                      
                      {alert.status === 'acknowledged' && (
                        <div className="mt-3">
                          <Button 
                            size="sm" 
                            className="w-full bg-green-500 hover:bg-green-600 text-white"
                            onClick={(e) => { e.stopPropagation(); clearRoute(alert.id || alert.alert_id); }}
                            disabled={isClearing}
                            data-testid={`clear-route-btn-${alert.id || alert.alert_id}`}
                          >
                            <Navigation className="w-4 h-4 mr-1" />
                            Clear Route
                          </Button>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Map View */}
        <div className="flex-1 relative">
          <MapContainer
            center={mapCenter}
            zoom={15}
            style={{ height: '100%', width: '100%' }}
            className="z-0"
          >
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; OpenStreetMap'
            />
            <MapCenterUpdater center={mapCenter} />
            
            {/* Ambulance marker */}
            {ambulanceLoc && (
              <Marker position={[ambulanceLoc.lat, ambulanceLoc.lng]} icon={ambulanceIcon}>
                <Popup>
                  <div className="text-sm">
                    <strong className="text-red-600">{selectedAlert?.ambulance_call_sign}</strong>
                    <br />Driver: {selectedAlert?.driver_name}
                    <br />Speed: {Math.round(selectedAlert?.speed || 0)} km/h
                    <br />Direction: {selectedAlert?.direction}
                  </div>
                </Popup>
              </Marker>
            )}
          </MapContainer>

          {/* Selected Alert Details Overlay */}
          {selectedAlert && (
            <div className="absolute top-4 right-4 z-[1000]">
              <Card className={`w-80 ${selectedAlert.status === 'active' ? 'border-red-500 bg-red-500/10' : 'border-zinc-700 bg-zinc-900/95'}`}>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-zinc-100">
                      <AlertTriangle className={`w-5 h-5 ${selectedAlert.status === 'active' ? 'text-red-500 animate-pulse' : 'text-amber-500'}`} />
                      {selectedAlert.ambulance_call_sign}
                    </div>
                    {getAlertStatusBadge(selectedAlert.status)}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-zinc-500">Driver</p>
                      <p className="text-zinc-100 font-medium">{selectedAlert.driver_name}</p>
                    </div>
                    <div>
                      <p className="text-zinc-500">Distance</p>
                      <p className="text-amber-400 font-bold text-lg">
                        {selectedAlert.distance_to_traffic_point_m || Math.round(selectedAlert.distance_to_traffic_point_km * 1000)}m
                      </p>
                    </div>
                    <div>
                      <p className="text-zinc-500">Speed</p>
                      <p className="text-zinc-100">{Math.round(selectedAlert.speed || 0)} km/h</p>
                    </div>
                    <div>
                      <p className="text-zinc-500">Direction</p>
                      <p className="text-zinc-100">{selectedAlert.direction || 'N/A'}</p>
                    </div>
                  </div>
                  
                  <div>
                    <p className="text-zinc-500 text-sm">Alert Time</p>
                    <p className="text-zinc-100 font-mono">{formatTime(selectedAlert.created_at)}</p>
                  </div>
                  
                  <div>
                    <p className="text-zinc-500 text-sm">Location</p>
                    <p className="text-zinc-300 font-mono text-xs">
                      {selectedAlert.location?.lat.toFixed(5)}, {selectedAlert.location?.lng.toFixed(5)}
                    </p>
                  </div>
                  
                  {selectedAlert.status === 'active' && (
                    <Button 
                      className="w-full bg-amber-500 hover:bg-amber-600 mt-2"
                      onClick={() => acknowledgeAlert(selectedAlert.id || selectedAlert.alert_id)}
                      disabled={isAcknowledging}
                    >
                      <CheckCircle className="w-4 h-4 mr-2" />
                      Acknowledge Alert
                    </Button>
                  )}
                  
                  {selectedAlert.status === 'acknowledged' && (
                    <Button 
                      className="w-full bg-green-500 hover:bg-green-600 mt-2"
                      onClick={() => clearRoute(selectedAlert.id || selectedAlert.alert_id)}
                      disabled={isClearing}
                    >
                      <Navigation className="w-4 h-4 mr-2" />
                      Clear Route
                    </Button>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {/* No Alert Selected */}
          {!selectedAlert && (
            <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/50 z-[500]">
              <Card className="bg-zinc-900 border-zinc-800 p-8 text-center">
                <Bell className="w-16 h-16 mx-auto mb-4 text-zinc-600" />
                <h3 className="text-xl font-semibold text-zinc-100 mb-2">Waiting for Alerts</h3>
                <p className="text-zinc-500">
                  When an ambulance driver sends an alert,<br />
                  it will appear here in real-time.
                </p>
              </Card>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PoliceDashboard;
