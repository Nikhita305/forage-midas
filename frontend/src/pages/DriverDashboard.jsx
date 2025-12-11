import React, { useEffect, useState, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap, Polyline } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { useWebSocket } from '../context/WebSocketContext';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { ScrollArea } from '../components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../components/ui/dialog';
import { 
  Ambulance, Phone, Clock, MapPin, Hospital, LogOut, Radio,
  AlertTriangle, Send, CheckCircle, Navigation, Route as RouteIcon
} from 'lucide-react';
import { Toaster, toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// Ambulance icon
const ambulanceIcon = L.divIcon({
  className: 'custom-ambulance-icon',
  html: `<div style="background: #ef4444; border-radius: 50%; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; border: 4px solid white; box-shadow: 0 0 25px rgba(239,68,68,0.7);">
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M10 10H6"/><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.28a1 1 0 0 0-.684-.948l-1.923-.641a1 1 0 0 1-.578-.502l-1.539-3.076A1 1 0 0 0 16.382 8H14"/><path d="M8 8v4"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/></svg>
  </div>`,
  iconSize: [44, 44],
  iconAnchor: [22, 22],
});

// Hospital icon
const hospitalIcon = L.divIcon({
  className: 'custom-hospital-icon',
  html: `<div style="background: #3b82f6; border-radius: 6px; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border: 2px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.3);">
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M12 6v4"/><path d="M14 14h-4"/><path d="M14 18h-4"/><path d="M14 8h-4"/><path d="M18 12h2a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2h2"/><path d="M18 22V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v18"/></svg>
  </div>`,
  iconSize: [32, 32],
  iconAnchor: [16, 16],
});

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
  const { isConnected, lastMessage, sendLocationUpdate } = useWebSocket();
  
  const [myAmbulance, setMyAmbulance] = useState(null);
  const [availableAmbulances, setAvailableAmbulances] = useState([]);
  const [nearbyHospitals, setNearbyHospitals] = useState([]);
  const [currentLocation, setCurrentLocation] = useState({ lat: 40.7128, lng: -74.0060 });
  const [showAmbulanceSelect, setShowAmbulanceSelect] = useState(false);
  const [alertSent, setAlertSent] = useState(false);
  const [alertStatus, setAlertStatus] = useState(null); // 'acknowledged', 'cleared'
  const [isSendingAlert, setIsSendingAlert] = useState(false);
  const [selectedHospital, setSelectedHospital] = useState(null);
  const [routeToHospital, setRouteToHospital] = useState([]);
  const [routeTrafficLevel, setRouteTrafficLevel] = useState('medium'); // 'low', 'medium', 'high'

  useEffect(() => {
    fetchMyAmbulance();
  }, []);

  useEffect(() => {
    if (currentLocation) {
      fetchNearbyHospitals();
    }
  }, [currentLocation.lat, currentLocation.lng]);

  // Handle status updates from police
  useEffect(() => {
    if (lastMessage) {
      if (lastMessage.type === 'alert_acknowledged') {
        setAlertStatus('acknowledged');
        toast.success(`✅ Alert acknowledged by ${lastMessage.data.acknowledged_by}`);
      } else if (lastMessage.type === 'route_cleared') {
        setAlertStatus('cleared');
        setAlertSent(false);
        toast.success(`🛣️ Route cleared by ${lastMessage.data.cleared_by}: ${lastMessage.data.message}`);
      }
    }
  }, [lastMessage]);

  // Simulate GPS movement
  useEffect(() => {
    if (myAmbulance) {
      const interval = setInterval(() => {
        setCurrentLocation(prev => ({
          lat: prev.lat + (Math.random() - 0.5) * 0.0008,
          lng: prev.lng + (Math.random() - 0.5) * 0.0008
        }));
        
        // Update location on server
        updateLocation();
      }, 3000);
      
      return () => clearInterval(interval);
    }
  }, [myAmbulance]);

  const fetchMyAmbulance = async () => {
    try {
      const response = await axios.get(`${API}/ambulances/my`);
      if (response.data) {
        setMyAmbulance(response.data);
        setCurrentLocation(response.data.location);
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
      setAlertSent(false);
      setAlertStatus(null);
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
        speed: Math.random() * 50 + 30,
        heading: Math.random() * 360
      });
    } catch (error) {
      console.error('Failed to update location:', error);
    }
  };

  const sendTrafficAlert = async () => {
    if (!myAmbulance) {
      toast.error('Select an ambulance first');
      return;
    }

    setIsSendingAlert(true);
    try {
      await axios.post(`${API}/alert/send`, {
        ambulance_id: myAmbulance.id,
        location: currentLocation,
        speed: Math.random() * 50 + 30,
        message: "🚨 Ambulance approaching — please clear the route!"
      });
      
      setAlertSent(true);
      setAlertStatus(null);
      toast.success('🚨 Alert sent to all traffic police!', { duration: 4000 });
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to send alert');
    } finally {
      setIsSendingAlert(false);
    }
  };

  // Generate route with waypoints and simulate traffic
  const generateRouteToHospital = (hospital) => {
    const start = currentLocation;
    const end = hospital.coordinates;
    
    // Calculate intermediate waypoints (simplified routing)
    const numWaypoints = 8;
    const waypoints = [];
    
    for (let i = 0; i <= numWaypoints; i++) {
      const ratio = i / numWaypoints;
      // Add some curve to make it look like a real route
      const curve = Math.sin(ratio * Math.PI) * 0.003;
      waypoints.push([
        start.lat + (end.lat - start.lat) * ratio + curve,
        start.lng + (end.lng - start.lng) * ratio + (Math.random() - 0.5) * 0.002
      ]);
    }
    
    // Simulate traffic level based on distance and time
    const distance = hospital.distance_km;
    const randomFactor = Math.random();
    
    let trafficLevel;
    if (distance < 1 && randomFactor > 0.7) {
      trafficLevel = 'low'; // Close and lucky - green
    } else if (distance > 2 || randomFactor < 0.3) {
      trafficLevel = 'high'; // Far or unlucky - red
    } else {
      trafficLevel = 'medium'; // Moderate - yellow
    }
    
    setRouteToHospital(waypoints);
    setRouteTrafficLevel(trafficLevel);
  };

  const selectHospital = (hospital) => {
    if (selectedHospital?.id === hospital.id) {
      // Deselect if clicking same hospital
      setSelectedHospital(null);
      setRouteToHospital([]);
    } else {
      setSelectedHospital(hospital);
      generateRouteToHospital(hospital);
      toast.info(`📍 Route to ${hospital.name}`, {
        description: `Traffic: ${
          routeTrafficLevel === 'low' ? '🟢 Low' : 
          routeTrafficLevel === 'medium' ? '🟡 Moderate' : 
          '🔴 High'
        }`
      });
    }
  };

  return (
    <div className="h-screen flex flex-col bg-zinc-950">
      <Toaster position="top-center" richColors />
      
      {/* Header */}
      <header className="h-16 bg-zinc-900 border-b border-zinc-800 px-4 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-red-500 flex items-center justify-center">
            <Ambulance className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-zinc-100">
              {myAmbulance ? myAmbulance.call_sign : 'Ambulance Driver'}
            </h1>
            <p className="text-xs text-zinc-500">{user?.name}</p>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs font-medium ${isConnected ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
            <Radio className="w-3 h-3" />
            {isConnected ? 'CONNECTED' : 'OFFLINE'}
          </div>
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
            
            {/* Ambulance marker */}
            {myAmbulance && (
              <Marker position={[currentLocation.lat, currentLocation.lng]} icon={ambulanceIcon}>
                <Popup>
                  <strong>{myAmbulance.call_sign}</strong>
                  <br />Driver: {user?.name}
                </Popup>
              </Marker>
            )}
            
            {/* Route to selected hospital */}
            {routeToHospital.length > 0 && (
              <Polyline
                positions={routeToHospital}
                color={
                  routeTrafficLevel === 'low' ? '#10b981' : 
                  routeTrafficLevel === 'medium' ? '#f59e0b' : 
                  '#ef4444'
                }
                weight={6}
                opacity={0.8}
                dashArray={routeTrafficLevel === 'high' ? '10, 10' : undefined}
              />
            )}

            {/* Hospital markers */}
            {nearbyHospitals.map(hospital => (
              <Marker 
                key={hospital.id} 
                position={[hospital.coordinates.lat, hospital.coordinates.lng]}
                icon={hospitalIcon}
              >
                <Popup>
                  <div className="text-sm">
                    <strong>{hospital.name}</strong>
                    <br />ETA: {hospital.eta_minutes} min
                    <br />Distance: {hospital.distance_km} km
                  </div>
                </Popup>
              </Marker>
            ))}
          </MapContainer>

          {/* SEND TRAFFIC ALERT BUTTON - Main CTA */}
          <div className="absolute top-4 left-4 right-4 z-[1000]">
            <Button 
              onClick={sendTrafficAlert}
              disabled={!myAmbulance || isSendingAlert || (alertSent && alertStatus !== 'cleared')}
              data-testid="send-alert-btn"
              className={`w-full h-20 text-xl font-bold shadow-2xl transition-all ${
                alertSent && !alertStatus 
                  ? 'bg-amber-500 hover:bg-amber-600' 
                  : alertStatus === 'acknowledged'
                  ? 'bg-green-500 hover:bg-green-600'
                  : alertStatus === 'cleared'
                  ? 'bg-blue-500 hover:bg-blue-600'
                  : 'bg-red-500 hover:bg-red-600 animate-pulse'
              }`}
            >
              {!myAmbulance ? (
                <>Select Ambulance First</>
              ) : alertStatus === 'cleared' ? (
                <>
                  <CheckCircle className="w-8 h-8 mr-3" />
                  Route Cleared - Send New Alert
                </>
              ) : alertStatus === 'acknowledged' ? (
                <>
                  <CheckCircle className="w-8 h-8 mr-3" />
                  Alert Acknowledged
                </>
              ) : alertSent ? (
                <>
                  <AlertTriangle className="w-8 h-8 mr-3 animate-bounce" />
                  Alert Sent - Waiting for Response...
                </>
              ) : (
                <>
                  <Send className="w-8 h-8 mr-3" />
                  🚨 SEND TRAFFIC ALERT
                </>
              )}
            </Button>
          </div>

          {/* Alert Status Card */}
          {alertSent && (
            <div className="absolute top-28 left-4 z-[1000]">
              <Card className={`w-72 ${alertStatus === 'acknowledged' ? 'border-green-500 bg-green-500/10' : alertStatus === 'cleared' ? 'border-blue-500 bg-blue-500/10' : 'border-amber-500 bg-amber-500/10'}`}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    {alertStatus === 'acknowledged' ? (
                      <CheckCircle className="w-5 h-5 text-green-400" />
                    ) : alertStatus === 'cleared' ? (
                      <Navigation className="w-5 h-5 text-blue-400" />
                    ) : (
                      <AlertTriangle className="w-5 h-5 text-amber-400 animate-pulse" />
                    )}
                    <span className="font-semibold text-zinc-100">
                      {alertStatus === 'acknowledged' ? 'Alert Acknowledged' : alertStatus === 'cleared' ? 'Route Cleared!' : 'Alert Active'}
                    </span>
                  </div>
                  <p className="text-sm text-zinc-400">
                    {alertStatus === 'acknowledged' 
                      ? 'Traffic police is clearing the route...'
                      : alertStatus === 'cleared'
                      ? 'Proceed safely. Route has been cleared.'
                      : 'Waiting for traffic police to acknowledge...'}
                  </p>
                </CardContent>
              </Card>
            </div>
          )}
        </div>

        {/* Right sidebar - Hospitals */}
        <div className="w-80 bg-zinc-900 border-l border-zinc-800 flex flex-col">
          {/* Location Info */}
          <div className="p-4 border-b border-zinc-800">
            <div className="flex items-center gap-2 text-zinc-400 text-sm mb-2">
              <MapPin className="w-4 h-4" />
              <span>Current Location</span>
            </div>
            <p className="text-zinc-100 font-mono text-sm">
              {currentLocation.lat.toFixed(5)}, {currentLocation.lng.toFixed(5)}
            </p>
          </div>

          {/* Nearby Hospitals */}
          <div className="flex-1 flex flex-col">
            <div className="p-4 border-b border-zinc-800">
              <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                <Hospital className="w-4 h-4 text-blue-500" />
                Nearby Hospitals
              </h3>
            </div>
            <ScrollArea className="flex-1">
              <div className="p-3 space-y-2">
                {nearbyHospitals.slice(0, 5).map(hospital => (
                  <Card key={hospital.id} className="bg-zinc-800 border-zinc-700" data-testid={`hospital-${hospital.id}`}>
                    <CardContent className="p-3">
                      <h4 className="font-medium text-zinc-100 text-sm mb-1">{hospital.name}</h4>
                      <div className="flex flex-wrap gap-1 mb-2">
                        {hospital.specialties?.slice(0, 2).map(spec => (
                          <Badge key={spec} variant="secondary" className="bg-zinc-700 text-zinc-300 text-xs">
                            {spec}
                          </Badge>
                        ))}
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-3">
                          <span className="text-green-400 font-medium flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {hospital.eta_minutes} min
                          </span>
                          <span className="text-zinc-400 flex items-center gap-1">
                            <MapPin className="w-3 h-3" />
                            {hospital.distance_km} km
                          </span>
                        </div>
                        <Button 
                          size="sm" 
                          variant="ghost"
                          className="h-6 px-2 text-blue-400 hover:text-blue-300"
                          onClick={() => window.open(`tel:${hospital.phone}`)}
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

          {/* Ambulance Info */}
          <div className="p-4 border-t border-zinc-800">
            {myAmbulance ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-zinc-100">{myAmbulance.call_sign}</p>
                    <p className="text-xs text-zinc-500">Assigned to you</p>
                  </div>
                  <Badge variant={alertSent ? 'destructive' : 'secondary'}>
                    {alertSent ? '🚨 EMERGENCY' : 'READY'}
                  </Badge>
                </div>
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="w-full border-zinc-700 text-zinc-400"
                  onClick={releaseAmbulance}
                  data-testid="release-ambulance-btn"
                >
                  Release Ambulance
                </Button>
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
                  <Ambulance className="w-4 h-4 mr-3 text-red-400" />
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
