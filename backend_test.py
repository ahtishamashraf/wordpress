import requests
import json
import sys
import asyncio
import websockets
from datetime import datetime

class CybernetixAPITester:
    def __init__(self, base_url="https://e2echat.preview.emergentagent.com"):
        self.base_url = base_url
        self.tests_run = 0
        self.tests_passed = 0
        self.room_id = None

    def run_test(self, name, method, endpoint, expected_status, data=None, headers=None):
        """Run a single API test"""
        url = f"{self.base_url}/{endpoint}"
        if headers is None:
            headers = {'Content-Type': 'application/json'}

        self.tests_run += 1
        print(f"\n🔍 Testing {name}...")
        print(f"   URL: {url}")
        
        try:
            if method == 'GET':
                response = requests.get(url, headers=headers, timeout=10)
            elif method == 'POST':
                response = requests.post(url, json=data, headers=headers, timeout=10)

            success = response.status_code == expected_status
            if success:
                self.tests_passed += 1
                print(f"✅ Passed - Status: {response.status_code}")
                try:
                    response_data = response.json()
                    print(f"   Response: {json.dumps(response_data, indent=2)}")
                    return True, response_data
                except:
                    print(f"   Response: {response.text}")
                    return True, {}
            else:
                print(f"❌ Failed - Expected {expected_status}, got {response.status_code}")
                print(f"   Response: {response.text}")
                return False, {}

        except Exception as e:
            print(f"❌ Failed - Error: {str(e)}")
            return False, {}

    def test_health_check(self):
        """Test health check endpoint"""
        success, response = self.run_test(
            "Health Check",
            "GET",
            "api/health",
            200
        )
        return success

    def test_create_room(self):
        """Test room creation"""
        success, response = self.run_test(
            "Create Room",
            "POST",
            "api/create-room",
            200
        )
        if success and 'room_id' in response:
            self.room_id = response['room_id']
            print(f"   Created room: {self.room_id}")
        return success

    def test_get_room_info(self):
        """Test getting room information"""
        if not self.room_id:
            print("❌ No room ID available for testing")
            return False
            
        success, response = self.run_test(
            "Get Room Info",
            "GET",
            f"api/room/{self.room_id}",
            200
        )
        return success

    def test_get_offers(self):
        """Test getting offers for a room"""
        room_id = self.room_id or "test-room"
        success, response = self.run_test(
            "Get Offers",
            "GET",
            f"api/offers/{room_id}",
            200
        )
        return success

    def test_signal_message(self):
        """Test HTTP signaling endpoint"""
        test_offer = {
            "type": "offer",
            "source": "test-client-123",
            "offer": {
                "type": "offer",
                "sdp": "v=0\r\no=- 123456789 2 IN IP4 127.0.0.1\r\n..."
            }
        }
        
        success, response = self.run_test(
            "Signal Message",
            "POST",
            "api/signal",
            200,
            data=test_offer
        )
        return success

    def test_get_stats(self):
        """Test API statistics endpoint"""
        success, response = self.run_test(
            "Get Stats",
            "GET",
            "api/stats",
            200
        )
        return success

    async def test_websocket_connection(self):
        """Test WebSocket connection for signaling"""
        print(f"\n🔍 Testing WebSocket Connection...")
        
        # Convert HTTPS URL to WSS for WebSocket
        ws_url = self.base_url.replace('https://', 'wss://') + '/api/ws/test-client-123'
        print(f"   WebSocket URL: {ws_url}")
        
        try:
            async with websockets.connect(ws_url, timeout=10) as websocket:
                print("✅ WebSocket connection established")
                
                # Test sending a message
                test_message = {
                    "type": "offer",
                    "target": "test-peer",
                    "offer": {
                        "type": "offer",
                        "sdp": "test-sdp-data"
                    }
                }
                
                await websocket.send(json.dumps(test_message))
                print("✅ Message sent successfully")
                
                # Try to receive a response (with timeout)
                try:
                    response = await asyncio.wait_for(websocket.recv(), timeout=5.0)
                    print(f"✅ Received response: {response}")
                except asyncio.TimeoutError:
                    print("⚠️  No response received (expected for test)")
                
                self.tests_passed += 1
                return True
                
        except Exception as e:
            print(f"❌ WebSocket test failed: {str(e)}")
            return False
        finally:
            self.tests_run += 1

def main():
    print("🚀 Starting Cybernetix Secure Chat API Tests")
    print("=" * 50)
    
    tester = CybernetixAPITester()
    
    # Run HTTP API tests
    print("\n📡 Testing HTTP API Endpoints")
    print("-" * 30)
    
    tester.test_health_check()
    tester.test_create_room()
    tester.test_get_room_info()
    tester.test_get_offers()
    tester.test_signal_message()
    tester.test_get_stats()
    
    # Run WebSocket test
    print("\n🔌 Testing WebSocket Connection")
    print("-" * 30)
    
    try:
        asyncio.run(tester.test_websocket_connection())
    except Exception as e:
        print(f"❌ WebSocket test setup failed: {str(e)}")
        tester.tests_run += 1
    
    # Print final results
    print("\n" + "=" * 50)
    print(f"📊 Test Results: {tester.tests_passed}/{tester.tests_run} tests passed")
    
    if tester.tests_passed == tester.tests_run:
        print("🎉 All tests passed!")
        return 0
    else:
        print(f"⚠️  {tester.tests_run - tester.tests_passed} tests failed")
        return 1

if __name__ == "__main__":
    sys.exit(main())