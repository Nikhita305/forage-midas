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
import { 
  Ambulance, Navigation, Phone, Clock, MapPin, 
  ShieldAlert, Activity, Hospital, LogOut, Zap, Radio
} from 'lucide-react';
import { Toaster, toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// Custom ambulance icon
const ambulanceIcon = L.divIcon({
  className: 'custom-ambulance-icon',
  html: `<div style="background: #ef4444; border-radius: 50%; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border: 3px solid white; box-shadow: 0 2px 10px rgba(0,0,0,0.3);">
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 10H6"/><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.28a1 1 0 0 0-.684-.948l-1.923-.641a1 1 0 0 1-.578-.502l-1.539-3.076A1 1 0 0 0 16.382 8H14"/><path d="M8 8v4"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/></svg>
  </div>`,
  iconSize: [32, 32],
  iconAnchor: [16, 16],
});

// Hospital icon
const hospitalIcon = L.divIcon({
  className: 'custom-hospital-icon',
  html: `<div style="background: #3b82f6; border-radius: 4px; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; border: 2px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.3);">
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 6v4"/><path d="M14 14h-4"/><path d="M14 18h-4"/><path d="M14 8h-4"/><path d="M18 12h2a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2h2"/><path d="M18 22V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v18"/></svg>
  </div>`,
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

// Map center updater component
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
  const { isConnected, sendLocationUpdate } = useWebSocket();
  
  const [assignedAmbulance, setAssignedAmbulance] = useState(null);
  const [emergencyMode, setEmergencyMode] = useState(false);
  const [currentRoute, setCurrentRoute] = useState(null);
  const [nearbyHospitals, setNearbyHospitals] = useState([]);
  const [assignedHospital, setAssignedHospital] = useState(null);
  const [currentLocation, setCurrentLocation] = useState({ lat: 40.7128, lng: -74.0060 });
  const [availableAmbulances, setAvailableAmbulances] = useState([]);

  // Fetch available ambulances on mount
  useEffect(() => {
    fetchAmbulances();
    fetchNearbyHospitals();
  }, []);

  // Simulate GPS tracking
  useEffect(() => {
    if (assignedAmbulance && emergencyMode) {
      const interval = setInterval(() => {
        // Simulate movement
        setCurrentLocation(prev => ({
          lat: prev.lat + (Math.random() - 0.5) * 0.001,
          lng: prev.lng + (Math.random() - 0.5) * 0.001
        }));
        
        if (assignedAmbulance) {
          sendLocationUpdate(assignedAmbulance.id, currentLocation.lat, currentLocation.lng, Math.random() * 60 + 20);
        }
      }, 5000);
      
      return () => clearInterval(interval);
    }
  }, [assignedAmbulance, emergencyMode, sendLocationUpdate, currentLocation]);

  const fetchAmbulances = async () => {
    try {
      const response = await axios.get(`${API}/ambulances`);
      setAvailableAmbulances(response.data);
      
      // Check if user already assigned to an ambulance
      const myAmbulance = response.data.find(a => a.driver_id === user?.id);
      if (myAmbulance) {
        setAssignedAmbulance(myAmbulance);
        setCurrentLocation(myAmbulance.location);
      }
    } catch (error) {
      console.error('Failed to fetch ambulances:', error);
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

  const assignToAmbulance = async (ambulanceId) => {
    try {
      await axios.post(`${API}/ambulance/${ambulanceId}/assign-driver`);
      fetchAmbulances();
      toast.success('Assigned to ambulance');
    } catch (error) {
      toast.error('Failed to assign ambulance');
    }
  };

  const toggleEmergencyMode = async () => {
    if (!assignedAmbulance) {
      toast.error('Please select an ambulance first');
      return;
    }

    const newMode = !emergencyMode;
    setEmergencyMode(newMode);

    try {
      await axios.post(`${API}/ambulance/${assignedAmbulance.id}/status`, null, {
        params: { status: newMode ? 'emergency' : 'available' }
      });

      if (newMode) {
        toast.success('Emergency mode activated', { 
          description: 'Priority routing enabled'
        });
        // Send emergency alert
        await axios.post(`${API}/alerts/send`, {
          ambulance_id: assignedAmbulance.id,
          location: currentLocation,
          radius_km: 1.0
        });
      } else {
        toast.info('Emergency mode deactivated');
      }
    } catch (error) {
      toast.error('Failed to update status');
    }
  };

  const requestRoute = async (hospitalId) => {
    if (!assignedAmbulance) return;
    
    const hospital = nearbyHospitals.find(h => h.id === hospitalId);
    if (!hospital) return;

    try {
      const response = await axios.post(`${API}/route/request`, {
        ambulance_id: assignedAmbulance.id,
        destination: hospital.coordinates,
        emergency: emergencyMode
      });
      
      setCurrentRoute(response.data.primary_route);
      setAssignedHospital(hospital);
      toast.success(`Route to ${hospital.name} calculated`);
    } catch (error) {
      toast.error('Failed to calculate route');
    }
  };

  const handleLogout = () => {
    logout();
  };

  return (
    <div className="h-screen flex flex-col bg-zinc-950">
      <Toaster position="top-center" richColors />
      
      {/* Header */}
      <header className="h-16 bg-zinc-900 border-b border-zinc-800 px-4 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-md bg-red-500 flex items-center justify-center">
            <Ambulance className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-zinc-100">Driver Dashboard</h1>
            <p className="text-xs text-zinc-500">{user?.name}</p>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs font-medium ${isConnected ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
            <Radio className="w-3 h-3" />
            {isConnected ? 'CONNECTED' : 'OFFLINE'}
          </div>
          <Button 
            variant="ghost" 
            size="sm"
            onClick={handleLogout}
            data-testid="logout-btn"
            className="text-zinc-400 hover:text-zinc-100"
          >
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
              attribution='&copy; OpenStreetMap contributors'
            />
            <MapUpdater center={[currentLocation.lat, currentLocation.lng]} />
            
            {/* Current ambulance position */}
            {assignedAmbulance && (
              <Marker position={[currentLocation.lat, currentLocation.lng]} icon={ambulanceIcon}>
                <Popup>
                  <div className="text-sm">
                    <strong>{assignedAmbulance.call_sign}</strong>
                    <br />
                    Status: {emergencyMode ? 'EMERGENCY' : 'Available'}
                  </div>
                </Popup>
              </Marker>
            )}
            
            {/* Nearby hospitals */}
            {nearbyHospitals.map(hospital => (
              <Marker 
                key={hospital.id} 
                position={[hospital.coordinates.lat, hospital.coordinates.lng]}
                icon={hospitalIcon}
              >
                <Popup>
                  <div className="text-sm">
                    <strong>{hospital.name}</strong>
                    <br />
                    ETA: {hospital.eta_minutes} min
                  </div>
                </Popup>
              </Marker>
            ))}
            
            {/* Route polyline */}
            {currentRoute && (
              <Polyline
                positions={currentRoute.points.map(p => [p.lat, p.lng])}
                color="#ef4444"
                weight={4}
                dashArray="10, 10"
              />
            )}
          </MapContainer>

          {/* Emergency Mode HUD */}
          <div className="map-hud map-hud-top-left">
            <Card className={`glass-card w-64 ${emergencyMode ? 'border-red-500' : ''}`}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <ShieldAlert className={`w-5 h-5 ${emergencyMode ? 'text-red-500' : 'text-zinc-500'}`} />
                    <span className="font-semibold text-zinc-100">Emergency Mode</span>
                  </div>
                  <Switch
                    checked={emergencyMode}
                    onCheckedChange={toggleEmergencyMode}
                    data-testid="emergency-toggle"
                    className="data-[state=checked]:bg-red-500"
                  />
                </div>
                
                {assignedAmbulance ? (
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between text-zinc-400">
                      <span>Unit:</span>
                      <span className="text-zinc-100 data-value">{assignedAmbulance.call_sign}</span>
                    </div>
                    <div className="flex justify-between text-zinc-400">
                      <span>Status:</span>
                      <Badge variant={emergencyMode ? 'destructive' : 'secondary'} className="text-xs">
                        {emergencyMode ? 'EMERGENCY' : assignedAmbulance.status?.toUpperCase()}
                      </Badge>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-zinc-500">No ambulance assigned</p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Route Info HUD */}
          {currentRoute && assignedHospital && (
            <div className="map-hud map-hud-bottom-left">
              <Card className="glass-card w-72">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Navigation className="w-4 h-4 text-blue-500" />
                    <span className="font-semibold text-zinc-100">Current Route</span>
                  </div>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center gap-2 text-zinc-300">
                      <Hospital className="w-4 h-4 text-blue-400" />
                      {assignedHospital.name}
                    </div>
                    <div className="flex justify-between text-zinc-400">
                      <span>Distance:</span>
                      <span className="text-zinc-100 data-value">{currentRoute.distance_km} km</span>
                    </div>
                    <div className="flex justify-between text-zinc-400">
                      <span>ETA:</span>
                      <span className="text-green-400 data-value">{currentRoute.duration_minutes} min</span>
                    </div>
                    {currentRoute.traffic_delay_minutes > 0 && (
                      <div className="flex justify-between text-zinc-400">
                        <span>Traffic Delay:</span>
                        <span className="text-amber-400 data-value">+{currentRoute.traffic_delay_minutes} min</span>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </div>

        {/* Right sidebar */}
        <div className="w-80 bg-zinc-900 border-l border-zinc-800 flex flex-col">
          {/* Ambulance Selection */}
          {!assignedAmbulance && (
            <div className="p-4 border-b border-zinc-800">
              <h3 className="text-sm font-semibold text-zinc-100 mb-3">Select Ambulance</h3>
              <ScrollArea className="h-32">
                <div className="space-y-2">
                  {availableAmbulances.filter(a => !a.driver_id && a.status === 'available').map(amb => (
                    <Button
                      key={amb.id}
                      variant="outline"
                      size="sm"
                      className="w-full justify-start bg-zinc-800 border-zinc-700 text-zinc-100 hover:bg-zinc-700"
                      onClick={() => assignToAmbulance(amb.id)}
                      data-testid={`select-ambulance-${amb.call_sign}`}
                    >
                      <Ambulance className="w-4 h-4 mr-2" />
                      {amb.call_sign}
                    </Button>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}

          {/* Nearby Hospitals */}
          <div className="flex-1 flex flex-col">
            <div className="p-4 border-b border-zinc-800">
              <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                <Hospital className="w-4 h-4 text-blue-500" />
                Nearby Hospitals
              </h3>
            </div>
            <ScrollArea className="flex-1">
              <div className="p-4 space-y-3">
                {nearbyHospitals.slice(0, 5).map(hospital => (
                  <Card 
                    key={hospital.id} 
                    className={`bg-zinc-800 border-zinc-700 cursor-pointer hover:border-zinc-600 transition-colors ${assignedHospital?.id === hospital.id ? 'border-blue-500' : ''}`}
                    onClick={() => requestRoute(hospital.id)}
                    data-testid={`hospital-card-${hospital.id}`}
                  >
                    <CardContent className="p-3">
                      <h4 className="font-medium text-zinc-100 text-sm mb-1">{hospital.name}</h4>
                      <div className="flex flex-wrap gap-1 mb-2">
                        {hospital.specialties?.slice(0, 3).map(spec => (
                          <Badge key={spec} variant="secondary" className="specialty-badge bg-zinc-700 text-zinc-300">
                            {spec}
                          </Badge>
                        ))}
                      </div>
                      <div className="flex items-center justify-between text-xs text-zinc-400">
                        <div className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          <span className="data-value">{hospital.eta_minutes} min</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Activity className="w-3 h-3" />
                          <span>{hospital.availability} beds</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </ScrollArea>
          </div>

          {/* Quick Actions */}
          <div className="p-4 border-t border-zinc-800 space-y-2">
            <Button 
              className={`w-full touch-btn ${emergencyMode ? 'bg-red-500 hover:bg-red-600 emergency-btn active' : 'bg-zinc-700 hover:bg-zinc-600'}`}
              onClick={toggleEmergencyMode}
              data-testid="emergency-btn"
            >
              <Zap className="w-5 h-5 mr-2" />
              {emergencyMode ? 'DEACTIVATE EMERGENCY' : 'ACTIVATE EMERGENCY'}
            </Button>
            
            {assignedHospital && (
              <Button 
                variant="outline" 
                className="w-full touch-btn border-zinc-700 text-zinc-100 hover:bg-zinc-800"
                onClick={() => window.open(`tel:${assignedHospital.phone}`)}
                data-testid="call-hospital-btn"
              >
                <Phone className="w-5 h-5 mr-2" />
                Call Hospital
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default DriverDashboard;
