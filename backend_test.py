import requests
import sys
import json
from datetime import datetime

class SmartAmbulanceAPITester:
    def __init__(self, base_url="https://smartambulance.preview.emergentagent.com/api"):
        self.base_url = base_url
        self.token = None
        self.admin_token = None
        self.driver_token = None
        self.tests_run = 0
        self.tests_passed = 0
        self.test_results = []
        self.ambulance_id = None
        self.hospital_id = None
        self.trip_id = None

    def log_test(self, name, success, details=""):
        """Log test result"""
        self.tests_run += 1
        if success:
            self.tests_passed += 1
            print(f"✅ {name}")
        else:
            print(f"❌ {name} - {details}")
        
        self.test_results.append({
            "test": name,
            "success": success,
            "details": details
        })

    def run_test(self, name, method, endpoint, expected_status, data=None, token=None):
        """Run a single API test"""
        url = f"{self.base_url}/{endpoint}"
        headers = {'Content-Type': 'application/json'}
        if token:
            headers['Authorization'] = f'Bearer {token}'

        try:
            if method == 'GET':
                response = requests.get(url, headers=headers, timeout=10)
            elif method == 'POST':
                response = requests.post(url, json=data, headers=headers, timeout=10)
            elif method == 'DELETE':
                response = requests.delete(url, headers=headers, timeout=10)

            success = response.status_code == expected_status
            details = f"Status: {response.status_code}"
            if not success:
                details += f" (Expected {expected_status})"
                try:
                    error_data = response.json()
                    details += f" - {error_data.get('detail', 'Unknown error')}"
                except:
                    details += f" - {response.text[:100]}"

            self.log_test(name, success, details)
            return success, response.json() if success and response.content else {}

        except Exception as e:
            self.log_test(name, False, f"Error: {str(e)}")
            return False, {}

    def test_health_check(self):
        """Test basic health endpoint"""
        success, _ = self.run_test("Health Check", "GET", "health", 200)
        return success

    def test_user_registration(self):
        """Test user registration for driver and admin roles only"""
        timestamp = datetime.now().strftime('%H%M%S')
        
        # Test admin registration
        admin_data = {
            "email": f"admin_{timestamp}@test.com",
            "password": "admin123",
            "name": f"Test Admin {timestamp}",
            "role": "admin"
        }
        success, response = self.run_test("Register Admin", "POST", "auth/register", 200, admin_data)
        if success and 'access_token' in response:
            self.admin_token = response['access_token']
        
        # Test driver registration
        driver_data = {
            "email": f"driver_{timestamp}@test.com",
            "password": "driver123",
            "name": f"Test Driver {timestamp}",
            "role": "driver"
        }
        success, response = self.run_test("Register Driver", "POST", "auth/register", 200, driver_data)
        if success and 'access_token' in response:
            self.driver_token = response['access_token']
        
        return self.admin_token and self.driver_token

    def test_user_login(self):
        """Test login with provided credentials"""
        login_data = {
            "email": "admin@test.com",
            "password": "admin123"
        }
        success, response = self.run_test("Login Admin", "POST", "auth/login", 200, login_data)
        if success and 'access_token' in response:
            self.token = response['access_token']
            return True
        return False

    def test_auth_endpoints(self):
        """Test authentication endpoints"""
        if not self.token:
            return False
        
        # Test /auth/me
        success, _ = self.run_test("Get Current User", "GET", "auth/me", 200, token=self.token)
        return success

    def test_ambulance_endpoints(self):
        """Test ambulance-related endpoints"""
        if not self.driver_token:
            return False
        
        # Get available ambulances
        success, ambulances = self.run_test("Get Available Ambulances", "GET", "ambulances/available", 200, token=self.driver_token)
        
        if success and ambulances:
            self.ambulance_id = ambulances[0]['id']
            
            # Test claim ambulance
            success, _ = self.run_test("Claim Ambulance", "POST", f"ambulance/{self.ambulance_id}/claim", 200, token=self.driver_token)
            
            # Test emergency mode toggle
            success, _ = self.run_test("Toggle Emergency Mode", "POST", f"ambulance/{self.ambulance_id}/emergency?enable=true", 200, token=self.driver_token)
            
            # Test location update
            location_data = {
                "ambulance_id": self.ambulance_id,
                "location": {"lat": 40.7128, "lng": -74.0060},
                "speed": 45.5,
                "heading": 90.0
            }
            success, _ = self.run_test("Update Ambulance Location", "POST", "ambulance/location", 200, location_data, token=self.driver_token)
            
            # Test get my ambulance
            success, _ = self.run_test("Get My Ambulance", "GET", "ambulances/my", 200, token=self.driver_token)
        
        return success

    def test_hospital_endpoints(self):
        """Test hospital-related endpoints"""
        if not self.token:
            return False
        
        # Get hospitals
        success, _ = self.run_test("Get Hospitals", "GET", "hospitals", 200, token=self.token)
        
        # Get nearby hospitals
        success, _ = self.run_test("Get Nearby Hospitals", "GET", "hospitals/nearby?lat=40.7128&lng=-74.0060", 200, token=self.token)
        
        return success

    def test_routing_endpoints(self):
        """Test routing endpoints"""
        if not self.driver_token or not self.ambulance_id:
            return False
        
        # Test route calculation
        route_data = {
            "ambulance_id": self.ambulance_id,
            "destination": {"lat": 40.7200, "lng": -74.0100},
            "emergency": True
        }
        success, _ = self.run_test("Calculate Route", "POST", "route/calculate", 200, route_data, token=self.driver_token)
        
        # Test route to hospital (need hospital ID first)
        success, hospitals = self.run_test("Get Hospitals for Route", "GET", "hospitals", 200, token=self.driver_token)
        if success and hospitals:
            self.hospital_id = hospitals[0]['id']
            success, _ = self.run_test("Calculate Route to Hospital", "POST", f"route/to-hospital/{self.hospital_id}?ambulance_id={self.ambulance_id}", 200, token=self.driver_token)
        
        return success

    def test_trip_endpoints(self):
        """Test trip management endpoints"""
        if not self.driver_token or not self.ambulance_id or not self.hospital_id:
            return False
        
        # Test start trip
        trip_data = {
            "ambulance_id": self.ambulance_id,
            "hospital_id": self.hospital_id
        }
        success, response = self.run_test("Start Trip", "POST", "trip/start", 200, trip_data, token=self.driver_token)
        if success and 'id' in response:
            self.trip_id = response['id']
        
        # Test get current trip
        success, _ = self.run_test("Get Current Trip", "GET", "trip/current", 200, token=self.driver_token)
        
        # Test end trip
        if self.trip_id:
            end_data = {"trip_id": self.trip_id}
            success, _ = self.run_test("End Trip", "POST", "trip/end", 200, end_data, token=self.driver_token)
        
        # Test trip history
        success, _ = self.run_test("Get Trip History", "GET", "trips/history", 200, token=self.driver_token)
        
        return success

    def test_admin_endpoints(self):
        """Test admin-only endpoints"""
        if not self.admin_token:
            return False
        
        # Test admin endpoints
        success, _ = self.run_test("Get Users (Admin)", "GET", "admin/users", 200, token=self.admin_token)
        success, _ = self.run_test("Get All Trips (Admin)", "GET", "admin/trips", 200, token=self.admin_token)
        success, _ = self.run_test("Seed Sample Data", "POST", "admin/seed-data", 200, token=self.admin_token)
        
        return success

    def test_role_based_access(self):
        """Test role-based access control"""
        if not self.driver_token:
            return False
        
        # Driver should NOT be able to access admin endpoints
        success, _ = self.run_test("Driver Access Admin (Should Fail)", "GET", "admin/users", 403, token=self.driver_token)
        
        # This test passes if it gets 403 (forbidden)
        return success

    def test_assign_hospital(self):
        """Test hospital assignment functionality"""
        if not self.dispatcher_token:
            return False
        
        # Get ambulances and hospitals first
        success, ambulances = self.run_test("Get Ambulances for Assignment", "GET", "ambulances", 200, token=self.dispatcher_token)
        success, hospitals = self.run_test("Get Hospitals for Assignment", "GET", "hospitals", 200, token=self.dispatcher_token)
        
        if success and ambulances and hospitals:
            assign_data = {
                "ambulance_id": ambulances[0]['id'],
                "hospital_id": hospitals[0]['id']
            }
            success, _ = self.run_test("Assign Hospital", "POST", "assign-hospital", 200, assign_data, token=self.dispatcher_token)
        
        return success

    def test_traffic_endpoints(self):
        """Test traffic-related endpoints"""
        if not self.token:
            return False
        
        success, _ = self.run_test("Get Traffic Events", "GET", "traffic/events", 200, token=self.token)
        return success

    def test_alert_endpoints(self):
        """Test alert endpoints"""
        if not self.token:
            return False
        
        success, _ = self.run_test("Get Alerts", "GET", "alerts", 200, token=self.token)
        return success

def main():
    print("🚑 Smart Ambulance API Testing Suite")
    print("=" * 50)
    
    tester = SmartAmbulanceAPITester()
    
    # Test sequence
    print("\n📡 Testing Basic Connectivity...")
    if not tester.test_health_check():
        print("❌ Health check failed - API may be down")
        return 1
    
    print("\n👥 Testing User Registration...")
    if not tester.test_user_registration():
        print("⚠️  Registration failed, trying existing credentials...")
        if not tester.test_user_login():
            print("❌ Both registration and login failed")
            return 1
    
    print("\n🔐 Testing Authentication...")
    tester.test_auth_endpoints()
    
    print("\n🚑 Testing Ambulance Endpoints...")
    tester.test_ambulance_endpoints()
    
    print("\n🏥 Testing Hospital Endpoints...")
    tester.test_hospital_endpoints()
    
    print("\n🗺️  Testing Routing Endpoints...")
    tester.test_routing_endpoints()
    
    print("\n👑 Testing Admin Endpoints...")
    tester.test_admin_endpoints()
    
    print("\n🔒 Testing Role-Based Access Control...")
    tester.test_role_based_access()
    
    print("\n📍 Testing Hospital Assignment...")
    tester.test_assign_hospital()
    
    print("\n🚦 Testing Traffic Endpoints...")
    tester.test_traffic_endpoints()
    
    print("\n🚨 Testing Alert Endpoints...")
    tester.test_alert_endpoints()
    
    # Print summary
    print("\n" + "=" * 50)
    print(f"📊 Test Results: {tester.tests_passed}/{tester.tests_run} passed")
    
    if tester.tests_passed == tester.tests_run:
        print("🎉 All tests passed!")
        return 0
    else:
        print(f"⚠️  {tester.tests_run - tester.tests_passed} tests failed")
        
        # Print failed tests
        print("\nFailed Tests:")
        for result in tester.test_results:
            if not result['success']:
                print(f"  - {result['test']}: {result['details']}")
        
        return 1

if __name__ == "__main__":
    sys.exit(main())