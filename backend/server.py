from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import json
import uuid
import logging
from datetime import datetime
from typing import Dict, List, Optional
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Cybernetix Secure Chat API", version="1.0.0")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify your frontend domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory storage for signaling (in production, use Redis or similar)
active_connections: Dict[str, WebSocket] = {}
pending_offers: Dict[str, dict] = {}
connection_pairs: Dict[str, str] = {}

class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}
        self.pending_offers: Dict[str, dict] = {}
        
    async def connect(self, websocket: WebSocket, connection_id: str):
        await websocket.accept()
        self.active_connections[connection_id] = websocket
        logger.info(f"Client {connection_id} connected")
        
    def disconnect(self, connection_id: str):
        if connection_id in self.active_connections:
            del self.active_connections[connection_id]
        if connection_id in self.pending_offers:
            del self.pending_offers[connection_id]
        logger.info(f"Client {connection_id} disconnected")
        
    async def send_personal_message(self, message: str, connection_id: str):
        if connection_id in self.active_connections:
            websocket = self.active_connections[connection_id]
            await websocket.send_text(message)

manager = ConnectionManager()

@app.get("/api/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "service": "Cybernetix Secure Chat API"}

@app.post("/api/create-room")
async def create_room():
    """Create a new chat room for peer connection"""
    room_id = str(uuid.uuid4())[:8].upper()
    
    # Store room info (in production, store in database)
    room_info = {
        "room_id": room_id,
        "created_at": datetime.utcnow().isoformat(),
        "status": "waiting",
        "participants": []
    }
    
    return {
        "room_id": room_id,
        "status": "created",
        "message": "Share this room ID with your peer to connect"
    }

@app.get("/api/room/{room_id}")
async def get_room_info(room_id: str):
    """Get room information"""
    # In a real app, fetch from database
    return {
        "room_id": room_id,
        "status": "active",
        "participants": len([conn for conn in active_connections.keys() if conn.startswith(room_id)])
    }

@app.websocket("/api/ws/{connection_id}")
async def websocket_endpoint(websocket: WebSocket, connection_id: str):
    """WebSocket endpoint for WebRTC signaling"""
    await manager.connect(websocket, connection_id)
    
    try:
        while True:
            # Receive message from client
            data = await websocket.receive_text()
            message_data = json.loads(data)
            
            message_type = message_data.get("type")
            target_id = message_data.get("target")
            
            logger.info(f"Received {message_type} from {connection_id}")
            
            if message_type == "offer":
                # Store offer for peer to retrieve
                manager.pending_offers[connection_id] = {
                    "offer": message_data.get("offer"),
                    "from": connection_id,
                    "timestamp": datetime.utcnow().isoformat()
                }
                
                # If target is specified, send directly
                if target_id and target_id in manager.active_connections:
                    await manager.send_personal_message(
                        json.dumps({
                            "type": "offer",
                            "offer": message_data.get("offer"),
                            "from": connection_id
                        }),
                        target_id
                    )
                
            elif message_type == "answer":
                # Send answer to the peer who made the offer
                if target_id and target_id in manager.active_connections:
                    await manager.send_personal_message(
                        json.dumps({
                            "type": "answer",
                            "answer": message_data.get("answer"),
                            "from": connection_id
                        }),
                        target_id
                    )
                    
            elif message_type == "ice-candidate":
                # Forward ICE candidate to peer
                if target_id and target_id in manager.active_connections:
                    await manager.send_personal_message(
                        json.dumps({
                            "type": "ice-candidate",
                            "candidate": message_data.get("candidate"),
                            "from": connection_id
                        }),
                        target_id
                    )
                    
            elif message_type == "join-room":
                room_id = message_data.get("room_id")
                # Find available peer in the room
                available_peers = [
                    conn_id for conn_id in manager.active_connections.keys() 
                    if conn_id != connection_id and conn_id in manager.pending_offers
                ]
                
                if available_peers:
                    peer_id = available_peers[0]
                    offer_data = manager.pending_offers[peer_id]
                    
                    # Send offer to joining peer
                    await manager.send_personal_message(
                        json.dumps({
                            "type": "offer",
                            "offer": offer_data["offer"],
                            "from": peer_id
                        }),
                        connection_id
                    )
                    
                    # Notify original peer about the joiner
                    await manager.send_personal_message(
                        json.dumps({
                            "type": "peer-joined",
                            "peer_id": connection_id
                        }),
                        peer_id
                    )
                    
    except WebSocketDisconnect:
        manager.disconnect(connection_id)
        logger.info(f"Client {connection_id} disconnected")
    except Exception as e:
        logger.error(f"WebSocket error for {connection_id}: {str(e)}")
        manager.disconnect(connection_id)

@app.get("/api/offers/{room_id}")
async def get_offers(room_id: str):
    """Get available offers in a room"""
    offers = []
    for conn_id, offer_data in manager.pending_offers.items():
        if conn_id.startswith(room_id) or room_id == "all":
            offers.append({
                "connection_id": conn_id,
                "timestamp": offer_data["timestamp"]
            })
    
    return {"offers": offers}

@app.post("/api/signal")
async def signal_message(message_data: dict):
    """HTTP endpoint for signaling messages (alternative to WebSocket)"""
    message_type = message_data.get("type")
    source_id = message_data.get("source")
    target_id = message_data.get("target")
    
    if not source_id:
        raise HTTPException(status_code=400, detail="Source ID required")
    
    if message_type == "offer":
        offer_id = str(uuid.uuid4())[:8]
        pending_offers[offer_id] = {
            "offer": message_data.get("offer"),
            "source": source_id,
            "timestamp": datetime.utcnow().isoformat()
        }
        return {"offer_id": offer_id, "status": "stored"}
        
    elif message_type == "answer" and target_id:
        # In a real implementation, you'd notify the target
        return {"status": "delivered"}
        
    else:
        raise HTTPException(status_code=400, detail="Invalid message type")

@app.get("/api/stats")
async def get_stats():
    """Get API statistics"""
    return {
        "active_connections": len(manager.active_connections),
        "pending_offers": len(manager.pending_offers),
        "uptime": "N/A",  # In production, track actual uptime
        "version": "1.0.0"
    }

@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    """Global exception handler"""
    logger.error(f"Global exception: {str(exc)}")
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error", "type": "server_error"}
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)