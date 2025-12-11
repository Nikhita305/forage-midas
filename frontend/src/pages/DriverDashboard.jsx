import React, { useEffect, useState, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
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
import { 
  Ambulance, Navigation, Phone, Clock, MapPin, 
  ShieldAlert, Activity, Hospital, LogOut, Zap, Radio,
  Play, Square, AlertTriangle, Route, Timer, ChevronRight
} from 'lucide-react';
import { Toaster, toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// Custom ambulance icon
const ambulanceIcon = L.divIcon({
  className: 'custom-ambulance-icon',
  html: `<div style="background: #ef4444; border-radius: 50%; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; border: 3px solid white; box-shadow: 0 0 20px rgba(239,68,68,0.5);">
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 10H6"/><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.28a1 1 0 0 0-.684-.948l-1.923-.641a1 1 0 0 1-.578-.502l-1.539-3.076A1 1 0 0 0 16.382 8H14"/><path d="M8 8v4"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/></svg>
  </div>`,
  iconSize: [36, 36],
  iconAnchor: [18, 18],
});

// Hospital icon
const hospitalIcon = L.divIcon({
  className: 'custom-hospital-icon',
  html: `<div style="background: #3b82f6; border-radius: 4px; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border: 2px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.3);">
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 6v4"/><path d="M14 14h-4"/><path d="M14 18h-4"/><path d="M14 8h-4"/><path d="M18 12h2a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2h2"/><path d="M18 22V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v18"/></svg>
  </div>`,
  iconSize: [32, 32],
  iconAnchor: [16, 16],
});

// Destination hospital icon (larger)
const destinationIcon = L.divIcon({
  className: 'custom-destination-icon',
  html: `<div style="background: #22c55e; border-radius: 4px; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; border: 3px solid white; box-shadow: 0 0 20px rgba(34,197,94,0.5);">
    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 6v4"/><path d="M14 14h-4"/><path d="M14 18h-4"/><path d="M14 8h-4"/><path d="M18 12h2a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2h2"/><path d="M18 22V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v18"/></svg>
  </div>`,
  iconSize: [40, 40],
  iconAnchor: [20, 20],
});

// Map center updater
const MapUpdater = ({ center, zoom }) => {
  const map = useMap();
  useEffect(() => {
    if (center) {
      map.setView(center, zoom || map.getZoom());
    }
  }, [center, zoom, map]);
  return null;
};

const DriverDashboard = () => {
  const { user, logout } = useAuth();
  const { isConnected, sendLocationUpdate } = useWebSocket();
  
  const [myAmbulance, setMyAmbulance] = useState(null);
  const [availableAmbulances, setAvailableAmbulances] = useState([]);
  const [emergencyMode, setEmergencyMode] = useState(false);
  const [currentTrip, setCurrentTrip] = useState(null);
  const [currentRoute, setCurrentRoute] = useState(null);
  const [backupRoute, setBackupRoute] = useState(null);
  const [nearbyHospitals, setNearbyHospitals] = useState([]);
  const [selectedHospital, setSelectedHospital] = useState(null);
  const [currentLocation, setCurrentLocation] = useState({ lat: 40.7128, lng: -74.0060 });
  const [showAmbulanceSelect, setShowAmbulanceSelect] = useState(false);
  const [tripHistory, setTripHistory] = useState([]);

  // Initial data fetch
  useEffect(() => {
    fetchMyAmbulance();
    fetchCurrentTrip();
    fetchTripHistory();
  }, []);

  // Fetch nearby hospitals when location changes
  useEffect(() => {
    if (currentLocation) {
      fetchNearbyHospitals();
    }
  }, [currentLocation.lat, currentLocation.lng]);

  // GPS simulation during active trip
  useEffect(() => {
    if (myAmbulance && currentTrip) {
      const interval = setInterval(() => {
        // Simulate movement towards destination
        setCurrentLocation(prev => {
          const dest = currentTrip.end_location;
          const newLat = prev.lat + (dest.lat - prev.lat) * 0.01 + (Math.random() - 0.5) * 0.0005;
          const newLng = prev.lng + (dest.lng - prev.lng) * 0.01 + (Math.random() - 0.5) * 0.0005;
          return { lat: newLat, lng: newLng };
        });
        
        // Send location update
        sendLocationUpdate(myAmbulance.id, currentLocation.lat, currentLocation.lng, Math.random() * 50 + 30);
        
        // Update location on server
        updateLocation();
      }, 3000);
      
      return () => clearInterval(interval);
    }
  }, [myAmbulance, currentTrip]);

  // Route recalculation during trip
  useEffect(() => {
    if (currentTrip && selectedHospital) {
      const interval = setInterval(() => {
        recalculateRoute();
      }, 15000); // Every 15 seconds
      
      return () => clearInterval(interval);
    }
  }, [currentTrip, selectedHospital]);

  const fetchMyAmbulance = async () => {
    try {
      const response = await axios.get(`${API}/ambulances/my`);
      if (response.data) {
        setMyAmbulance(response.data);
        setCurrentLocation(response.data.location);
        setEmergencyMode(response.data.status === 'emergency');
      } else {
        // No ambulance assigned, show selection
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
        // Fetch hospital details
        const hospResponse = await axios.get(`${API}/hospitals/${response.data.destination_hospital_id}`);
        setSelectedHospital(hospResponse.data);
      }
    } catch (error) {
      console.error('Failed to fetch current trip:', error);
    }
  };

  const fetchTripHistory = async () => {
    try {
      const response = await axios.get(`${API}/trips/history?limit=5`);
      setTripHistory(response.data);
    } catch (error) {
      console.error('Failed to fetch trip history:', error);
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
      toast.error(error.response?.data?.detail || 'Failed to release ambulance');
    }
  };

  const updateLocation = async () => {
    if (!myAmbulance) return;
    try {
      await axios.post(`${API}/ambulance/location`, {
        ambulance_id: myAmbulance.id,
        location: currentLocation,
        speed: Math.random() * 50 + 30,
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
      await axios.post(`${API}/ambulance/${myAmbulance.id}/emergency?enable=${newMode}`);
      setEmergencyMode(newMode);
      
      if (newMode) {
        toast.success('🚨 Emergency mode activated - Traffic alerts sent');
      } else {
        toast.info('Emergency mode deactivated');
      }
    } catch (error) {
      toast.error('Failed to toggle emergency mode');
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
      setBackupRoute(response.data.backup_route);
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
      toast.success('Trip started - Navigate to ' + selectedHospital.name);
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
      setBackupRoute(null);
      setSelectedHospital(null);
      setEmergencyMode(false);
      toast.success('Trip completed');
      fetchTripHistory();
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
      setBackupRoute(response.data.backup_route);
      
      // Show warning if traffic delays increased
      if (response.data.primary_route.traffic_warnings?.length > 0) {
        toast.warning(response.data.primary_route.traffic_warnings[0]);
      }
    } catch (error) {
      console.error('Failed to recalculate route:', error);
    }
  };

  const switchToBackupRoute = () => {
    if (backupRoute) {
      const temp = currentRoute;
      setCurrentRoute(backupRoute);
      setBackupRoute(temp);
      toast.success('Switched to alternate route');
    }
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
              {myAmbulance ? myAmbulance.call_sign : 'Driver Dashboard'}
            </h1>
            <p className="text-xs text-zinc-500">{user?.name}</p>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs font-medium ${isConnected ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
            <Radio className="w-3 h-3" />
            {isConnected ? 'CONNECTED' : 'OFFLINE'}
          </div>
          {currentTrip && (
            <Badge variant="destructive" className="animate-pulse">
              ACTIVE TRIP
            </Badge>
          )}
          <Button variant="ghost" size="sm" onClick={logout} data-testid="logout-btn" className="text-zinc-400 hover:text-zinc-100">
            <LogOut className="w-4 h-4 mr-2" />
            Logout
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
            
            {/* Current ambulance position */}
            {myAmbulance && (
              <Marker position={[currentLocation.lat, currentLocation.lng]} icon={ambulanceIcon}>
                <Popup>
                  <div className="text-sm font-medium">
                    {myAmbulance.call_sign}
                    <br />
                    <span className="text-zinc-500">{emergencyMode ? '🚨 EMERGENCY' : 'Available'}</span>
                  </div>
                </Popup>
              </Marker>
            )}
            
            {/* Nearby hospitals */}
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
                    {hospital.specialties?.join(', ')}
                  </div>
                </Popup>
              </Marker>
            ))}
            
            {/* Route polyline */}
            {currentRoute && (
              <Polyline
                positions={currentRoute.points.map(p => [p.lat, p.lng])}
                color="#ef4444"
                weight={5}
                opacity={0.9}
              />
            )}
            
            {/* Backup route */}
            {backupRoute && (
              <Polyline
                positions={backupRoute.points.map(p => [p.lat, p.lng])}
                color="#3b82f6"
                weight={3}
                opacity={0.5}
                dashArray="10, 10"
              />
            )}
          </MapContainer>

          {/* Emergency Mode Toggle HUD */}
          <div className="absolute top-4 left-4 z-[1000]">
            <Card className={`glass-card w-56 ${emergencyMode ? 'border-red-500 shadow-red-500/20 shadow-lg' : ''}`}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ShieldAlert className={`w-5 h-5 ${emergencyMode ? 'text-red-500 animate-pulse' : 'text-zinc-500'}`} />
                    <span className="font-semibold text-zinc-100 text-sm">Emergency</span>
                  </div>
                  <Switch
                    checked={emergencyMode}
                    onCheckedChange={toggleEmergencyMode}
                    data-testid="emergency-toggle"
                    className="data-[state=checked]:bg-red-500"
                  />
                </div>
                {emergencyMode && (
                  <p className="text-xs text-red-400 mt-2">Traffic alerts broadcasting</p>
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
                      <span className="font-semibold text-zinc-100">Current Route</span>
                    </div>
                    {backupRoute && (
                      <Button 
                        size="sm" 
                        variant="outline" 
                        className="text-xs border-zinc-700 text-zinc-300"
                        onClick={switchToBackupRoute}
                        data-testid="switch-route-btn"
                      >
                        <Route className="w-3 h-3 mr-1" />
                        Alt Route
                      </Button>
                    )}
                  </div>
                  
                  {selectedHospital && (
                    <div className="flex items-center gap-2 mb-3 pb-3 border-b border-zinc-800">
                      <Hospital className="w-4 h-4 text-blue-400" />
                      <span className="text-zinc-200 text-sm">{selectedHospital.name}</span>
                    </div>
                  )}
                  
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
                      <p className={`text-2xl font-bold data-value ${currentRoute.traffic_delay_minutes > 0 ? 'text-amber-400' : 'text-green-400'}`}>
                        {currentRoute.traffic_delay_minutes > 0 ? `+${currentRoute.traffic_delay_minutes}` : '0'}
                      </p>
                      <p className="text-xs text-zinc-500">delay</p>
                    </div>
                  </div>
                  
                  {/* Next Turn */}
                  <div className="bg-zinc-800 rounded p-2 flex items-center gap-2">
                    <ChevronRight className="w-5 h-5 text-blue-400" />
                    <span className="text-sm text-zinc-200">{currentRoute.next_turn}</span>
                  </div>
                  
                  {/* Traffic Warnings */}
                  {currentRoute.traffic_warnings?.length > 0 && (
                    <div className="mt-3 space-y-1">
                      {currentRoute.traffic_warnings.map((warning, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs text-amber-400">
                          <AlertTriangle className="w-3 h-3" />
                          {warning}
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
              <div className="mt-3 p-3 bg-zinc-800 rounded">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-zinc-400">Destination:</span>
                  <span className="text-zinc-100 font-medium">{currentTrip.destination_hospital_name}</span>
                </div>
                <div className="flex items-center justify-between text-sm mt-1">
                  <span className="text-zinc-400">Traffic:</span>
                  <Badge variant={currentTrip.traffic_conditions === 'heavy' ? 'destructive' : 'secondary'}>
                    {currentTrip.traffic_conditions?.toUpperCase()}
                  </Badge>
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
              <p className="text-xs text-zinc-500 mt-1">Tap to select destination</p>
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
                        <div className="flex items-center gap-2">
                          <div className="flex items-center gap-1 text-green-400">
                            <Clock className="w-3 h-3" />
                            <span className="data-value font-medium">{hospital.eta_minutes} min</span>
                          </div>
                          <div className="flex items-center gap-1 text-zinc-400">
                            <MapPin className="w-3 h-3" />
                            <span className="data-value">{hospital.distance_km} km</span>
                          </div>
                        </div>
                        <Button 
                          size="sm" 
                          variant="ghost"
                          className="h-6 px-2 text-blue-400 hover:text-blue-300"
                          onClick={(e) => { e.stopPropagation(); window.open(`tel:${hospital.phone}`); }}
                          data-testid={`call-hospital-${hospital.id}`}
                        >
                          <Phone className="w-3 h-3" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </ScrollArea>
          </div>

          {/* Ambulance Info / Selection */}
          <div className="p-4 border-t border-zinc-800">
            {myAmbulance ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-zinc-100">{myAmbulance.call_sign}</p>
                    <p className="text-xs text-zinc-500">Assigned to you</p>
                  </div>
                  <Badge variant={emergencyMode ? 'destructive' : 'secondary'}>
                    {emergencyMode ? 'EMERGENCY' : myAmbulance.status?.toUpperCase()}
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
    </div>
  );
};

export default DriverDashboard;
