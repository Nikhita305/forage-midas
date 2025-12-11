import React, { useEffect, useState, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, Circle, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { useWebSocket } from '../context/WebSocketContext';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Switch } from '../components/ui/switch';
import { ScrollArea } from '../components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../components/ui/dialog';
import { Progress } from '../components/ui/progress';
import { 
  Ambulance, Navigation, Phone, Clock, MapPin, 
  ShieldAlert, Hospital, LogOut, Zap, Radio,
  Play, Square, AlertTriangle, Route, ChevronRight,
  Send, Activity, AlertCircle, Gauge, MapPinned
} from 'lucide-react';
import { Toaster, toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// Ambulance icon
const ambulanceIcon = L.divIcon({
  className: 'custom-ambulance-icon',
  html: `<div style="background: #ef4444; border-radius: 50%; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; border: 3px solid white; box-shadow: 0 0 20px rgba(239,68,68,0.6);">
    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M10 10H6"/><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.28a1 1 0 0 0-.684-.948l-1.923-.641a1 1 0 0 1-.578-.502l-1.539-3.076A1 1 0 0 0 16.382 8H14"/><path d="M8 8v4"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/></svg>
  </div>`,
  iconSize: [40, 40],
  iconAnchor: [20, 20],
});

// Hospital icon
const hospitalIcon = L.divIcon({
  className: 'custom-hospital-icon',
  html: `<div style="background: #3b82f6; border-radius: 4px; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border: 2px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.3);">
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M12 6v4"/><path d="M14 14h-4"/><path d="M14 18h-4"/><path d="M14 8h-4"/><path d="M18 12h2a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2h2"/><path d="M18 22V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v18"/></svg>
  </div>`,
  iconSize: [32, 32],
  iconAnchor: [16, 16],
});

// Destination hospital icon
const destinationIcon = L.divIcon({
  className: 'custom-destination-icon',
  html: `<div style="background: #22c55e; border-radius: 4px; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; border: 3px solid white; box-shadow: 0 0 20px rgba(34,197,94,0.5);">
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M12 6v4"/><path d="M14 14h-4"/><path d="M14 18h-4"/><path d="M14 8h-4"/><path d="M18 12h2a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2h2"/><path d="M18 22V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v18"/></svg>
  </div>`,
  iconSize: [44, 44],
  iconAnchor: [22, 22],
});

// Congestion colors
const congestionColors = {
  low: '#22c55e',
  moderate: '#eab308',
  high: '#f97316',
  severe: '#ef4444'
};

// Map updater
const MapUpdater = ({ center }) => {
  const map = useMap();
  useEffect(() => {
    if (center) {
      map.setView(center, map.getZoom());
    }
  }, [center, map]);
  return null;
};

const DriverDashboard = () => {
  const { user, logout } = useAuth();
  const { isConnected, sendLocationUpdate, lastMessage } = useWebSocket();
  
  const [myAmbulance, setMyAmbulance] = useState(null);
  const [availableAmbulances, setAvailableAmbulances] = useState([]);
  const [emergencyMode, setEmergencyMode] = useState(false);
  const [currentTrip, setCurrentTrip] = useState(null);
  const [currentRoute, setCurrentRoute] = useState(null);
  const [alternateRoute, setAlternateRoute] = useState(null);
  const [nearbyHospitals, setNearbyHospitals] = useState([]);
  const [selectedHospital, setSelectedHospital] = useState(null);
  const [trafficZones, setTrafficZones] = useState([]);
  const [currentLocation, setCurrentLocation] = useState({ lat: 40.7128, lng: -74.0060 });
  const [showAmbulanceSelect, setShowAmbulanceSelect] = useState(false);
  const [showManualAlert, setShowManualAlert] = useState(false);
  const [alertsSent, setAlertsSent] = useState(0);

  // Initial data fetch
  useEffect(() => {
    fetchMyAmbulance();
    fetchCurrentTrip();
  }, []);

  // Fetch nearby hospitals and traffic zones when location changes
  useEffect(() => {
    fetchNearbyHospitals();
    fetchTrafficZones();
  }, [currentLocation.lat, currentLocation.lng]);

  // Handle incoming WebSocket messages (traffic alerts)
  useEffect(() => {
    if (lastMessage && lastMessage.type === 'traffic_alert') {
      toast.info(`📡 Alert: ${lastMessage.data?.message || 'Traffic alert received'}`);
    }
  }, [lastMessage]);

  // GPS simulation during active trip
  useEffect(() => {
    if (myAmbulance && currentTrip) {
      const interval = setInterval(() => {
        setCurrentLocation(prev => {
          const dest = currentTrip.end_location;
          const newLat = prev.lat + (dest.lat - prev.lat) * 0.008 + (Math.random() - 0.5) * 0.0003;
          const newLng = prev.lng + (dest.lng - prev.lng) * 0.008 + (Math.random() - 0.5) * 0.0003;
          return { lat: newLat, lng: newLng };
        });
        
        sendLocationUpdate(myAmbulance.id, currentLocation.lat, currentLocation.lng, Math.random() * 50 + 40);
        updateLocation();
      }, 2000);
      
      return () => clearInterval(interval);
    }
  }, [myAmbulance, currentTrip]);

  // Route recalculation every 15 seconds
  useEffect(() => {
    if (currentTrip && selectedHospital) {
      const interval = setInterval(() => {
        recalculateRoute();
      }, 15000);
      return () => clearInterval(interval);
    }
  }, [currentTrip, selectedHospital]);

  const fetchMyAmbulance = async () => {
    try {
      const response = await axios.get(`${API}/ambulances/my`);
      if (response.data) {
        setMyAmbulance(response.data);
        setCurrentLocation(response.data.location);
        setEmergencyMode(response.data.emergency_mode || false);
      } else {
        fetchAvailableAmbulances();
        setShowAmbulanceSelect(true);
      }
    } catch (error) {
      fetchAvailableAmbulances();
      setShowAmbulanceSelect(true);
    }
  };

  const fetchAvailableAmbulances = async () => {
    try {
      const response = await axios.get(`${API}/ambulances/available`);
      setAvailableAmbulances(response.data);
    } catch (error) {
      console.error('Failed to fetch ambulances:', error);
    }
  };

  const fetchCurrentTrip = async () => {
    try {
      const response = await axios.get(`${API}/trip/current`);
      if (response.data) {
        setCurrentTrip(response.data);
        setCurrentRoute(response.data.route);
        setAlertsSent(response.data.alerts_sent || 0);
        const hospResponse = await axios.get(`${API}/hospitals/${response.data.destination_hospital_id}`);
        setSelectedHospital(hospResponse.data);
      }
    } catch (error) {
      console.error('Failed to fetch current trip:', error);
    }
  };

  const fetchNearbyHospitals = async () => {
    try {
      const response = await axios.get(`${API}/hospitals/nearby`, {
        params: { lat: currentLocation.lat, lng: currentLocation.lng }
      });
      setNearbyHospitals(response.data);
    } catch (error) {
      console.error('Failed to fetch hospitals:', error);
    }
  };

  const fetchTrafficZones = async () => {
    try {
      const response = await axios.get(`${API}/traffic/zones`, {
        params: { lat: currentLocation.lat, lng: currentLocation.lng }
      });
      setTrafficZones(response.data);
    } catch (error) {
      console.error('Failed to fetch traffic zones:', error);
    }
  };

  const claimAmbulance = async (ambulanceId) => {
    try {
      await axios.post(`${API}/ambulance/${ambulanceId}/claim`);
      toast.success('Ambulance assigned');
      setShowAmbulanceSelect(false);
      fetchMyAmbulance();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to claim ambulance');
    }
  };

  const releaseAmbulance = async () => {
    if (!myAmbulance) return;
    try {
      await axios.post(`${API}/ambulance/${myAmbulance.id}/release`);
      toast.success('Ambulance released');
      setMyAmbulance(null);
      setShowAmbulanceSelect(true);
      fetchAvailableAmbulances();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to release');
    }
  };

  const updateLocation = async () => {
    if (!myAmbulance) return;
    try {
      await axios.post(`${API}/ambulance/location`, {
        ambulance_id: myAmbulance.id,
        location: currentLocation,
        speed: Math.random() * 50 + 40,
        heading: 0
      });
    } catch (error) {
      console.error('Failed to update location:', error);
    }
  };

  const toggleEmergencyMode = async () => {
    if (!myAmbulance) {
      toast.error('Select an ambulance first');
      return;
    }

    try {
      const newMode = !emergencyMode;
      const response = await axios.post(`${API}/ambulance/${myAmbulance.id}/emergency?enable=${newMode}`);
      setEmergencyMode(newMode);
      
      if (newMode) {
        toast.success('🚨 Emergency Mode ON - Alerts being sent to traffic authorities', {
          duration: 4000
        });
      } else {
        toast.info('Emergency mode deactivated');
      }
    } catch (error) {
      toast.error('Failed to toggle emergency mode');
    }
  };

  const sendManualAlert = async () => {
    if (!myAmbulance) return;
    
    try {
      await axios.post(`${API}/alerts/traffic`, {
        ambulance_id: myAmbulance.id,
        message: "Requesting traffic assistance - please clear path",
        location: currentLocation,
        eta_minutes: currentRoute?.duration_minutes
      });
      
      setAlertsSent(prev => prev + 1);
      toast.success('📡 Alert sent to traffic control center');
      setShowManualAlert(false);
    } catch (error) {
      toast.error('Failed to send alert');
    }
  };

  const selectHospital = async (hospital) => {
    if (!myAmbulance) {
      toast.error('Select an ambulance first');
      return;
    }
    
    setSelectedHospital(hospital);
    
    try {
      const response = await axios.post(`${API}/route/to-hospital/${hospital.id}?ambulance_id=${myAmbulance.id}`);
      setCurrentRoute(response.data.primary_route);
      setAlternateRoute(response.data.alternate_route);
      if (response.data.traffic_zones) {
        setTrafficZones(response.data.traffic_zones);
      }
      toast.success(`Route to ${hospital.name} calculated`);
    } catch (error) {
      toast.error('Failed to calculate route');
    }
  };

  const startTrip = async () => {
    if (!myAmbulance || !selectedHospital) {
      toast.error('Select ambulance and hospital first');
      return;
    }

    try {
      const response = await axios.post(`${API}/trip/start`, {
        ambulance_id: myAmbulance.id,
        hospital_id: selectedHospital.id
      });
      setCurrentTrip(response.data);
      setCurrentRoute(response.data.route);
      setAlertsSent(0);
      toast.success('🚑 Trip started - Navigate to ' + selectedHospital.name);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to start trip');
    }
  };

  const endTrip = async () => {
    if (!currentTrip) return;

    try {
      await axios.post(`${API}/trip/end`, { trip_id: currentTrip.id });
      setCurrentTrip(null);
      setCurrentRoute(null);
      setAlternateRoute(null);
      setSelectedHospital(null);
      setEmergencyMode(false);
      setAlertsSent(0);
      toast.success('Trip completed');
      fetchMyAmbulance();
    } catch (error) {
      toast.error('Failed to end trip');
    }
  };

  const recalculateRoute = async () => {
    if (!myAmbulance || !selectedHospital) return;
    
    try {
      const response = await axios.post(`${API}/route/to-hospital/${selectedHospital.id}?ambulance_id=${myAmbulance.id}`);
      setCurrentRoute(response.data.primary_route);
      setAlternateRoute(response.data.alternate_route);
      
      if (response.data.primary_route.congestion_level === 'severe') {
        toast.warning('🚧 Severe traffic detected! Consider alternate route');
      }
    } catch (error) {
      console.error('Failed to recalculate route:', error);
    }
  };

  const switchToAlternateRoute = () => {
    if (alternateRoute) {
      const temp = currentRoute;
      setCurrentRoute(alternateRoute);
      setAlternateRoute(temp);
      toast.success('Switched to alternate route');
    }
  };

  const getCongestionBadge = (level) => {
    const styles = {
      low: 'bg-green-500/20 text-green-400 border-green-500/30',
      moderate: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
      high: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
      severe: 'bg-red-500/20 text-red-400 border-red-500/30 animate-pulse'
    };
    return styles[level] || styles.low;
  };

  return (
    <div className="h-screen flex flex-col bg-zinc-950">
      <Toaster position="top-center" richColors />
      
      {/* Header */}
      <header className="h-16 bg-zinc-900 border-b border-zinc-800 px-4 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-md flex items-center justify-center ${emergencyMode ? 'bg-red-500 animate-pulse' : 'bg-red-500'}`}>
            <Ambulance className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-zinc-100">
              {myAmbulance ? myAmbulance.call_sign : 'Emergency Response'}
            </h1>
            <p className="text-xs text-zinc-500">{user?.name}</p>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs font-medium ${isConnected ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
            <Radio className="w-3 h-3" />
            {isConnected ? 'LIVE' : 'OFFLINE'}
          </div>
          {emergencyMode && (
            <Badge variant="destructive" className="animate-pulse">
              🚨 EMERGENCY
            </Badge>
          )}
          {currentTrip && (
            <Badge variant="outline" className="border-blue-500 text-blue-400">
              ON TRIP
            </Badge>
          )}
          <Button variant="ghost" size="sm" onClick={logout} data-testid="logout-btn" className="text-zinc-400 hover:text-zinc-100">
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Map */}
        <div className="flex-1 relative">
          <MapContainer
            center={[currentLocation.lat, currentLocation.lng]}
            zoom={14}
            style={{ height: '100%', width: '100%' }}
            className="z-0"
          >
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; OpenStreetMap'
            />
            <MapUpdater center={[currentLocation.lat, currentLocation.lng]} />
            
            {/* Traffic congestion zones */}
            {trafficZones.map((zone, idx) => (
              <Circle
                key={idx}
                center={[zone.location.lat, zone.location.lng]}
                radius={zone.radius_km * 1000}
                pathOptions={{
                  color: congestionColors[zone.congestion_level] || congestionColors.low,
                  fillColor: congestionColors[zone.congestion_level] || congestionColors.low,
                  fillOpacity: 0.25,
                  weight: 2
                }}
              >
                <Popup>
                  <div className="text-sm">
                    <strong className="capitalize">{zone.congestion_level} Traffic</strong>
                    <br />
                    {zone.description}
                    {zone.incident_type && <><br /><span className="text-orange-600">Type: {zone.incident_type}</span></>}
                    {zone.blocked && <><br /><span className="text-red-600 font-bold">⚠️ ROAD BLOCKED</span></>}
                  </div>
                </Popup>
              </Circle>
            ))}
            
            {/* Ambulance marker */}
            {myAmbulance && (
              <Marker position={[currentLocation.lat, currentLocation.lng]} icon={ambulanceIcon}>
                <Popup>
                  <div className="text-sm font-medium">
                    {myAmbulance.call_sign}
                    <br />
                    <span className="text-zinc-500">{emergencyMode ? '🚨 EMERGENCY MODE' : 'Available'}</span>
                  </div>
                </Popup>
              </Marker>
            )}
            
            {/* Hospital markers */}
            {nearbyHospitals.map(hospital => (
              <Marker 
                key={hospital.id} 
                position={[hospital.coordinates.lat, hospital.coordinates.lng]}
                icon={selectedHospital?.id === hospital.id ? destinationIcon : hospitalIcon}
                eventHandlers={{ click: () => !currentTrip && selectHospital(hospital) }}
              >
                <Popup>
                  <div className="text-sm">
                    <strong>{hospital.name}</strong>
                    <br />
                    ETA: {hospital.eta_minutes} min | {hospital.distance_km} km
                    <br />
                    Traffic: <span className="capitalize">{hospital.congestion_level || 'low'}</span>
                  </div>
                </Popup>
              </Marker>
            ))}
            
            {/* Primary route */}
            {currentRoute && (
              <Polyline
                positions={currentRoute.points.map(p => [p.lat, p.lng])}
                color="#ef4444"
                weight={5}
                opacity={0.9}
              />
            )}
            
            {/* Alternate route */}
            {alternateRoute && (
              <Polyline
                positions={alternateRoute.points.map(p => [p.lat, p.lng])}
                color="#3b82f6"
                weight={3}
                opacity={0.5}
                dashArray="8, 8"
              />
            )}
          </MapContainer>

          {/* Emergency Mode HUD */}
          <div className="absolute top-4 left-4 z-[1000]">
            <Card className={`glass-card w-64 ${emergencyMode ? 'border-red-500 shadow-red-500/30 shadow-lg' : ''}`}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <ShieldAlert className={`w-5 h-5 ${emergencyMode ? 'text-red-500 animate-pulse' : 'text-zinc-500'}`} />
                    <span className="font-semibold text-zinc-100">Emergency Mode</span>
                  </div>
                  <Switch
                    checked={emergencyMode}
                    onCheckedChange={toggleEmergencyMode}
                    data-testid="emergency-toggle"
                    className="data-[state=checked]:bg-red-500"
                  />
                </div>
                
                {emergencyMode && (
                  <>
                    <p className="text-xs text-red-400 mb-3">🚨 Traffic alerts active</p>
                    <Button 
                      size="sm" 
                      variant="outline"
                      className="w-full border-red-500/50 text-red-400 hover:bg-red-500/10"
                      onClick={() => setShowManualAlert(true)}
                      data-testid="manual-alert-btn"
                    >
                      <Send className="w-4 h-4 mr-2" />
                      Send Manual Alert
                    </Button>
                    {alertsSent > 0 && (
                      <p className="text-xs text-zinc-500 mt-2 text-center">
                        Alerts sent: {alertsSent}
                      </p>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Route Info HUD */}
          {currentRoute && (
            <div className="absolute bottom-4 left-4 z-[1000]">
              <Card className="glass-card w-80">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Navigation className="w-5 h-5 text-red-500" />
                      <span className="font-semibold text-zinc-100">Navigation</span>
                    </div>
                    {alternateRoute && (
                      <Button 
                        size="sm" 
                        variant="outline" 
                        className="text-xs border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                        onClick={switchToAlternateRoute}
                        data-testid="switch-route-btn"
                      >
                        <Route className="w-3 h-3 mr-1" />
                        Alt Route
                      </Button>
                    )}
                  </div>
                  
                  {selectedHospital && (
                    <div className="flex items-center gap-2 mb-3 pb-3 border-b border-zinc-800">
                      <Hospital className="w-4 h-4 text-green-400" />
                      <span className="text-zinc-200 text-sm">{selectedHospital.name}</span>
                    </div>
                  )}
                  
                  {/* Stats */}
                  <div className="grid grid-cols-3 gap-3 mb-3">
                    <div className="text-center">
                      <p className="text-2xl font-bold text-zinc-100 data-value">{currentRoute.duration_minutes}</p>
                      <p className="text-xs text-zinc-500">min ETA</p>
                    </div>
                    <div className="text-center">
                      <p className="text-2xl font-bold text-zinc-100 data-value">{currentRoute.distance_km}</p>
                      <p className="text-xs text-zinc-500">km</p>
                    </div>
                    <div className="text-center">
                      <Badge className={`${getCongestionBadge(currentRoute.congestion_level)} text-xs px-2`}>
                        {currentRoute.congestion_level?.toUpperCase()}
                      </Badge>
                      <p className="text-xs text-zinc-500 mt-1">traffic</p>
                    </div>
                  </div>
                  
                  {/* Traffic delay */}
                  {currentRoute.traffic_delay_minutes > 0 && (
                    <div className="mb-3 p-2 bg-amber-500/10 rounded border border-amber-500/20">
                      <div className="flex items-center gap-2 text-amber-400 text-sm">
                        <Clock className="w-4 h-4" />
                        <span>+{currentRoute.traffic_delay_minutes} min traffic delay</span>
                      </div>
                    </div>
                  )}
                  
                  {/* Next Turn */}
                  <div className="bg-zinc-800 rounded p-2 flex items-center gap-2 mb-3">
                    <ChevronRight className="w-5 h-5 text-blue-400" />
                    <span className="text-sm text-zinc-200">{currentRoute.next_turn}</span>
                  </div>
                  
                  {/* Traffic Warnings */}
                  {currentRoute.traffic_warnings?.length > 0 && (
                    <div className="space-y-1">
                      {currentRoute.traffic_warnings.slice(0, 3).map((warning, i) => (
                        <div key={i} className="flex items-start gap-2 text-xs text-amber-400">
                          <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                          <span>{warning}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  
                  {/* Blocked Roads */}
                  {currentRoute.blocked_roads?.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {currentRoute.blocked_roads.map((road, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs text-red-400">
                          <AlertCircle className="w-3 h-3" />
                          <span>{road}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </div>

        {/* Right sidebar */}
        <div className="w-80 bg-zinc-900 border-l border-zinc-800 flex flex-col">
          {/* Trip Controls */}
          <div className="p-4 border-b border-zinc-800">
            {!currentTrip ? (
              <Button 
                className="w-full h-14 bg-green-500 hover:bg-green-600 text-white font-bold text-lg"
                onClick={startTrip}
                disabled={!myAmbulance || !selectedHospital}
                data-testid="start-trip-btn"
              >
                <Play className="w-6 h-6 mr-2" />
                START TRIP
              </Button>
            ) : (
              <Button 
                className="w-full h-14 bg-red-500 hover:bg-red-600 text-white font-bold text-lg"
                onClick={endTrip}
                data-testid="end-trip-btn"
              >
                <Square className="w-6 h-6 mr-2" />
                END TRIP
              </Button>
            )}
            
            {currentTrip && (
              <div className="mt-3 p-3 bg-zinc-800 rounded space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-zinc-400">Destination:</span>
                  <span className="text-zinc-100 font-medium text-right text-xs">{currentTrip.destination_hospital_name}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-zinc-400">Traffic:</span>
                  <Badge className={`${getCongestionBadge(currentTrip.congestion_level)} text-xs`}>
                    {currentTrip.congestion_level?.toUpperCase()}
                  </Badge>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-zinc-400">Alerts sent:</span>
                  <span className="text-zinc-100 data-value">{alertsSent}</span>
                </div>
              </div>
            )}
          </div>

          {/* Nearby Hospitals */}
          <div className="flex-1 flex flex-col">
            <div className="p-4 border-b border-zinc-800">
              <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                <Hospital className="w-4 h-4 text-blue-500" />
                Nearby Hospitals
              </h3>
              <p className="text-xs text-zinc-500 mt-1">Sorted by ETA • Traffic-aware</p>
            </div>
            <ScrollArea className="flex-1">
              <div className="p-3 space-y-2">
                {nearbyHospitals.slice(0, 6).map(hospital => (
                  <Card 
                    key={hospital.id} 
                    className={`bg-zinc-800 border-zinc-700 cursor-pointer hover:border-zinc-600 transition-all ${selectedHospital?.id === hospital.id ? 'border-green-500 ring-1 ring-green-500/20' : ''}`}
                    onClick={() => !currentTrip && selectHospital(hospital)}
                    data-testid={`hospital-card-${hospital.id}`}
                  >
                    <CardContent className="p-3">
                      <h4 className="font-medium text-zinc-100 text-sm mb-1">{hospital.name}</h4>
                      <div className="flex flex-wrap gap-1 mb-2">
                        {hospital.specialties?.slice(0, 3).map(spec => (
                          <Badge key={spec} variant="secondary" className="specialty-badge bg-zinc-700 text-zinc-300 text-xs">
                            {spec}
                          </Badge>
                        ))}
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-1 text-green-400">
                            <Clock className="w-3 h-3" />
                            <span className="data-value font-medium">{hospital.eta_minutes} min</span>
                          </div>
                          <div className="flex items-center gap-1 text-zinc-400">
                            <MapPin className="w-3 h-3" />
                            <span className="data-value">{hospital.distance_km} km</span>
                          </div>
                        </div>
                        <Badge className={`${getCongestionBadge(hospital.congestion_level)} text-xs px-1.5`}>
                          <Gauge className="w-3 h-3" />
                        </Badge>
                      </div>
                      <div className="mt-2 flex justify-end">
                        <Button 
                          size="sm" 
                          variant="ghost"
                          className="h-7 px-2 text-blue-400 hover:text-blue-300 hover:bg-blue-500/10"
                          onClick={(e) => { e.stopPropagation(); window.open(`tel:${hospital.phone}`); }}
                        >
                          <Phone className="w-3 h-3 mr-1" />
                          Call
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </ScrollArea>
          </div>

          {/* Ambulance Info */}
          <div className="p-4 border-t border-zinc-800">
            {myAmbulance ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-zinc-100">{myAmbulance.call_sign}</p>
                    <p className="text-xs text-zinc-500">Assigned to you</p>
                  </div>
                  <Badge variant={emergencyMode ? 'destructive' : 'secondary'}>
                    {emergencyMode ? '🚨 EMERGENCY' : myAmbulance.status?.toUpperCase()}
                  </Badge>
                </div>
                {!currentTrip && (
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="w-full border-zinc-700 text-zinc-400"
                    onClick={releaseAmbulance}
                    data-testid="release-ambulance-btn"
                  >
                    Release Ambulance
                  </Button>
                )}
              </div>
            ) : (
              <Button 
                className="w-full bg-blue-500 hover:bg-blue-600"
                onClick={() => setShowAmbulanceSelect(true)}
                data-testid="select-ambulance-btn"
              >
                <Ambulance className="w-4 h-4 mr-2" />
                Select Ambulance
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Ambulance Selection Dialog */}
      <Dialog open={showAmbulanceSelect && !myAmbulance} onOpenChange={setShowAmbulanceSelect}>
        <DialogContent className="bg-zinc-900 border-zinc-800">
          <DialogHeader>
            <DialogTitle className="text-zinc-100">Select Ambulance</DialogTitle>
            <DialogDescription className="text-zinc-500">
              Choose an available ambulance to begin
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 mt-4">
            {availableAmbulances.length > 0 ? (
              availableAmbulances.map(amb => (
                <Button
                  key={amb.id}
                  variant="outline"
                  className="w-full justify-start bg-zinc-800 border-zinc-700 text-zinc-100 hover:bg-zinc-700"
                  onClick={() => claimAmbulance(amb.id)}
                  data-testid={`claim-ambulance-${amb.call_sign}`}
                >
                  <Ambulance className="w-4 h-4 mr-3" />
                  {amb.call_sign}
                  <span className="ml-auto text-xs text-zinc-500">Available</span>
                </Button>
              ))
            ) : (
              <p className="text-zinc-500 text-center py-4">No ambulances available</p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Manual Alert Dialog */}
      <Dialog open={showManualAlert} onOpenChange={setShowManualAlert}>
        <DialogContent className="bg-zinc-900 border-zinc-800">
          <DialogHeader>
            <DialogTitle className="text-zinc-100 flex items-center gap-2">
              <Send className="w-5 h-5 text-red-500" />
              Send Alert to Traffic Control
            </DialogTitle>
            <DialogDescription className="text-zinc-500">
              Request traffic assistance for faster response
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 space-y-4">
            <div className="p-4 bg-zinc-800 rounded">
              <p className="text-sm text-zinc-300 mb-2">Alert Message:</p>
              <p className="text-zinc-100">"Requesting traffic assistance - please clear path"</p>
            </div>
            <div className="flex items-center justify-between text-sm text-zinc-400">
              <span>Current Location:</span>
              <span className="data-value">{currentLocation.lat.toFixed(4)}, {currentLocation.lng.toFixed(4)}</span>
            </div>
            {currentRoute && (
              <div className="flex items-center justify-between text-sm text-zinc-400">
                <span>ETA to Hospital:</span>
                <span className="data-value">{currentRoute.duration_minutes} min</span>
              </div>
            )}
            <Button 
              className="w-full bg-red-500 hover:bg-red-600"
              onClick={sendManualAlert}
              data-testid="confirm-send-alert-btn"
            >
              <Send className="w-4 h-4 mr-2" />
              Send Alert Now
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default DriverDashboard;
