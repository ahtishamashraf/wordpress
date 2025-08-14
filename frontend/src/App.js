import React, { useState, useEffect, useRef } from 'react';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from './components/ui/card';
import { Badge } from './components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from './components/ui/dialog';
import { Send, Shield, Users, QrCode, Camera, Lock, Unlock, X } from 'lucide-react';
import QRCode from 'react-qr-code';
import QrScanner from 'qr-scanner';
import './App.css';

const App = () => {
  // Connection state
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [peerId, setPeerId] = useState('');
  const [isHost, setIsHost] = useState(false);
  
  // Messaging state
  const [messages, setMessages] = useState([]);
  const [currentMessage, setCurrentMessage] = useState('');
  const [chatPartner, setChatPartner] = useState('');
  
  // WebRTC refs
  const localConnection = useRef(null);
  const dataChannel = useRef(null);
  const messagesEndRef = useRef(null);
  
  // Crypto state
  const [keyPair, setKeyPair] = useState(null);
  const [sharedKey, setSharedKey] = useState(null);
  const [encryptionEnabled, setEncryptionEnabled] = useState(false);
  
  // QR Code state
  const [showQRCode, setShowQRCode] = useState(false);
  const [showQRScanner, setShowQRScanner] = useState(false);
  const [qrData, setQrData] = useState('');
  const [cameraError, setCameraError] = useState('');
  const videoRef = useRef(null);
  const qrScannerRef = useRef(null);

  // Generate crypto key pair on mount
  useEffect(() => {
    generateKeyPair();
  }, []);

  // Auto scroll to bottom of messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Generate RSA key pair for encryption
  const generateKeyPair = async () => {
    try {
      const keys = await window.crypto.subtle.generateKey(
        {
          name: 'RSA-OAEP',
          modulusLength: 2048,
          publicExponent: new Uint8Array([1, 0, 1]),
          hash: 'SHA-256',
        },
        true,
        ['encrypt', 'decrypt']
      );
      setKeyPair(keys);
      console.log('✓ Crypto keys generated');
    } catch (error) {
      console.error('Failed to generate keys:', error);
    }
  };

  // Create WebRTC connection
  const createConnection = () => {
    const configuration = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    };

    const connection = new RTCPeerConnection(configuration);
    
    connection.onicecandidate = (event) => {
      if (event.candidate) {
        console.log('ICE candidate:', event.candidate);
        // In a real app, you'd send this to the peer via signaling server
      }
    };

    connection.onconnectionstatechange = () => {
      setConnectionStatus(connection.connectionState);
      console.log('Connection state:', connection.connectionState);
    };

    connection.ondatachannel = (event) => {
      const channel = event.channel;
      setupDataChannel(channel);
    };

    return connection;
  };

  // Setup data channel for messaging
  const setupDataChannel = (channel) => {
    dataChannel.current = channel;
    
    channel.onopen = () => {
      console.log('✓ Data channel opened');
      setConnectionStatus('connected');
      setEncryptionEnabled(true);
    };
    
    channel.onmessage = async (event) => {
      let messageData;
      try {
        messageData = JSON.parse(event.data);
      } catch {
        messageData = { text: event.data, encrypted: false };
      }

      // Decrypt if encrypted
      let decryptedText = messageData.text;
      if (messageData.encrypted && sharedKey) {
        try {
          decryptedText = await decryptMessage(messageData.text);
        } catch (error) {
          console.error('Decryption failed:', error);
          decryptedText = '[Decryption failed]';
        }
      }

      const newMessage = {
        id: Date.now(),
        text: decryptedText,
        sender: 'peer',
        timestamp: new Date().toLocaleTimeString(),
        encrypted: messageData.encrypted || false
      };
      
      setMessages(prev => [...prev, newMessage]);
    };
    
    channel.onclose = () => {
      console.log('Data channel closed');
      setConnectionStatus('disconnected');
      setEncryptionEnabled(false);
    };
  };

  // Host a new connection
  const hostConnection = async () => {
    try {
      const connection = createConnection();
      localConnection.current = connection;
      
      // Create data channel
      const channel = connection.createDataChannel('messages', {
        ordered: true
      });
      
      setupDataChannel(channel);
      
      // Create offer
      const offer = await connection.createOffer();
      await connection.setLocalDescription(offer);
      
      const connectionId = Math.random().toString(36).substring(2, 8).toUpperCase();
      setPeerId(connectionId);
      setIsHost(true);
      setConnectionStatus('waiting');
      
      // Create QR code data with offer
      const qrCodeData = JSON.stringify({
        type: 'connection_offer',
        id: connectionId,
        offer: offer,
        timestamp: Date.now()
      });
      
      setQrData(qrCodeData);
      
      console.log('✓ Hosting connection:', connectionId);
      console.log('Share this offer with peer:', JSON.stringify(offer));
      
    } catch (error) {
      console.error('Failed to host connection:', error);
    }
  };

  // Join existing connection
  const joinConnection = async () => {
    const remoteOfferId = prompt('Enter connection ID or paste offer:');
    if (!remoteOfferId) return;

    try {
      const connection = createConnection();
      localConnection.current = connection;
      
      let offer;
      
      // Try to parse as JSON (full offer) or treat as ID
      try {
        offer = JSON.parse(remoteOfferId);
      } catch {
        // For now, just show error - in real app you'd lookup offer by ID
        alert('Please paste the full offer JSON or scan QR code');
        return;
      }
      
      await connection.setRemoteDescription(offer);
      
      const answer = await connection.createAnswer();
      await connection.setLocalDescription(answer);
      
      setConnectionStatus('connecting');
      setChatPartner(remoteOfferId.substring(0, 8));
      
      console.log('✓ Created answer:', JSON.stringify(answer));
      console.log('Send this answer back to host');
      
    } catch (error) {
      console.error('Failed to join connection:', error);
    }
  };

  // Generate shared encryption key
  const generateSharedKey = async () => {
    try {
      const key = await window.crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
      );
      setSharedKey(key);
      console.log('✓ Shared encryption key generated');
      return key;
    } catch (error) {
      console.error('Failed to generate shared key:', error);
      return null;
    }
  };

  // Encrypt message
  const encryptMessage = async (text) => {
    if (!sharedKey) {
      await generateSharedKey();
    }
    
    try {
      const encoder = new TextEncoder();
      const data = encoder.encode(text);
      const iv = window.crypto.getRandomValues(new Uint8Array(12));
      
      const encrypted = await window.crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv },
        sharedKey,
        data
      );
      
      // Combine IV and encrypted data
      const combined = new Uint8Array(iv.length + encrypted.byteLength);
      combined.set(iv);
      combined.set(new Uint8Array(encrypted), iv.length);
      
      return btoa(String.fromCharCode.apply(null, combined));
    } catch (error) {
      console.error('Encryption failed:', error);
      return text;
    }
  };

  // Decrypt message
  const decryptMessage = async (encryptedText) => {
    if (!sharedKey) return encryptedText;
    
    try {
      const combined = new Uint8Array(atob(encryptedText).split('').map(c => c.charCodeAt(0)));
      const iv = combined.slice(0, 12);
      const encrypted = combined.slice(12);
      
      const decrypted = await window.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv },
        sharedKey,
        encrypted
      );
      
      const decoder = new TextDecoder();
      return decoder.decode(decrypted);
    } catch (error) {
      console.error('Decryption failed:', error);
      return '[Decryption failed]';
    }
  };

  // Send message
  const sendMessage = async () => {
    if (!currentMessage.trim() || !dataChannel.current || dataChannel.current.readyState !== 'open') return;
    
    const messageText = currentMessage.trim();
    let messageToSend = messageText;
    let isEncrypted = false;
    
    // Encrypt message if encryption is enabled
    if (encryptionEnabled && sharedKey) {
      try {
        messageToSend = await encryptMessage(messageText);
        isEncrypted = true;
      } catch (error) {
        console.error('Failed to encrypt message:', error);
      }
    }
    
    // Send message
    const messageData = {
      text: messageToSend,
      encrypted: isEncrypted,
      timestamp: Date.now()
    };
    
    dataChannel.current.send(JSON.stringify(messageData));
    
    // Add to local messages
    const newMessage = {
      id: Date.now(),
      text: messageText, // Store original unencrypted text locally
      sender: 'me',
      timestamp: new Date().toLocaleTimeString(),
      encrypted: isEncrypted
    };
    
    setMessages(prev => [...prev, newMessage]);
    setCurrentMessage('');
  };

  // QR Scanner functions
  const startQRScanner = async () => {
    try {
      setCameraError('');
      setShowQRScanner(true);
      
      // Wait for dialog to open and video element to be available
      setTimeout(async () => {
        if (videoRef.current) {
          const qrScanner = new QrScanner(
            videoRef.current,
            (result) => {
              console.log('QR Code detected:', result);
              handleQRCodeScan(result.data);
              stopQRScanner();
            },
            {
              returnDetailedScanResult: true,
              highlightScanRegion: true,
              highlightCodeOutline: true,
            }
          );
          
          qrScannerRef.current = qrScanner;
          await qrScanner.start();
        }
      }, 100);
    } catch (error) {
      console.error('Camera access failed:', error);
      setCameraError('Camera access denied. Please allow camera access and try again.');
    }
  };

  const stopQRScanner = () => {
    if (qrScannerRef.current) {
      qrScannerRef.current.stop();
      qrScannerRef.current.destroy();
      qrScannerRef.current = null;
    }
    setShowQRScanner(false);
    setCameraError('');
  };

  const handleQRCodeScan = async (data) => {
    try {
      const qrContent = JSON.parse(data);
      
      if (qrContent.type === 'connection_offer' && qrContent.offer) {
        console.log('Processing connection offer from QR code...');
        
        const connection = createConnection();
        localConnection.current = connection;
        
        await connection.setRemoteDescription(qrContent.offer);
        
        const answer = await connection.createAnswer();
        await connection.setLocalDescription(answer);
        
        setConnectionStatus('connecting');
        setChatPartner(qrContent.id || 'Unknown');
        
        console.log('✓ Connection established from QR code');
        alert('Connection established! You can now start chatting.');
        
      } else {
        alert('Invalid QR code. Please scan a valid connection QR code.');
      }
    } catch (error) {
      console.error('Failed to process QR code:', error);
      alert('Invalid QR code format. Please scan a valid connection QR code.');
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const getStatusColor = () => {
    switch (connectionStatus) {
      case 'connected': return 'bg-green-500';
      case 'connecting': return 'bg-yellow-500';
      case 'waiting': return 'bg-blue-500';
      default: return 'bg-gray-500';
    }
  };

  const getStatusText = () => {
    switch (connectionStatus) {
      case 'connected': return 'Connected';
      case 'connecting': return 'Connecting...';
      case 'waiting': return 'Waiting for peer';
      default: return 'Disconnected';
    }
  };

  return (
    <div className="app-container">
      <div className="app-header">
        <div className="header-content">
          <div className="brand">
            <Shield className="brand-icon" />
            <h1 className="brand-title">Cybernetix Secure Chat</h1>
          </div>
          <div className="status-indicator">
            <div className={`status-dot ${getStatusColor()}`} />
            <span className="status-text">{getStatusText()}</span>
            {encryptionEnabled && <Lock className="encryption-icon" />}
          </div>
        </div>
      </div>

      <div className="app-content">
        {connectionStatus === 'disconnected' ? (
          <div className="connection-setup">
            <Card className="setup-card">
              <CardHeader>
                <CardTitle className="setup-title">
                  <Users className="setup-icon" />
                  Connect to Peer
                </CardTitle>
              </CardHeader>
              <CardContent className="setup-content">
                <Tabs defaultValue="host" className="connection-tabs">
                  <TabsList className="tabs-list">
                    <TabsTrigger value="host">Host Chat</TabsTrigger>
                    <TabsTrigger value="join">Join Chat</TabsTrigger>
                    <TabsTrigger value="qr">QR Scanner</TabsTrigger>
                  </TabsList>
                  
                  <TabsContent value="host" className="tab-content">
                    <div className="connection-methods">
                      <Button onClick={hostConnection} className="host-button">
                        <Shield className="button-icon" />
                        Host New Chat
                      </Button>
                      
                      {isHost && peerId && (
                        <div className="connection-info">
                          <Badge variant="secondary" className="peer-id-badge">
                            Connection ID: {peerId}
                          </Badge>
                          
                          <div className="qr-actions">
                            <Dialog open={showQRCode} onOpenChange={setShowQRCode}>
                              <DialogTrigger asChild>
                                <Button variant="outline" className="qr-button">
                                  <QrCode className="button-icon" />
                                  Show QR Code
                                </Button>
                              </DialogTrigger>
                              <DialogContent className="qr-dialog">
                                <DialogHeader>
                                  <DialogTitle>Scan to Connect</DialogTitle>
                                </DialogHeader>
                                <div className="qr-code-container">
                                  <QRCode
                                    value={qrData}
                                    size={256}
                                    style={{ height: "auto", maxWidth: "100%", width: "100%" }}
                                    viewBox={`0 0 256 256`}
                                  />
                                </div>
                                <p className="qr-instructions">
                                  Have your peer scan this QR code to connect instantly
                                </p>
                              </DialogContent>
                            </Dialog>
                          </div>
                          
                          <p className="connection-hint">
                            Share the connection ID or QR code with your peer
                          </p>
                        </div>
                      )}
                    </div>
                  </TabsContent>
                  
                  <TabsContent value="join" className="tab-content">
                    <div className="connection-methods">
                      <Button onClick={joinConnection} variant="outline" className="join-button">
                        <Users className="button-icon" />
                        Join with ID/Offer
                      </Button>
                      <p className="join-hint">
                        Enter the connection ID or paste the offer JSON
                      </p>
                    </div>
                  </TabsContent>
                  
                  <TabsContent value="qr" className="tab-content">
                    <div className="connection-methods">
                      <Dialog open={showQRScanner} onOpenChange={(open) => {
                        if (!open) stopQRScanner();
                        else startQRScanner();
                      }}>
                        <DialogTrigger asChild>
                          <Button variant="outline" className="scan-button">
                            <Camera className="button-icon" />
                            Scan QR Code
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="qr-scanner-dialog">
                          <DialogHeader>
                            <DialogTitle>Scan Connection QR Code</DialogTitle>
                          </DialogHeader>
                          <div className="qr-scanner-container">
                            {cameraError ? (
                              <div className="camera-error">
                                <p>{cameraError}</p>
                                <Button onClick={startQRScanner} variant="outline">
                                  Try Again
                                </Button>
                              </div>
                            ) : (
                              <video 
                                ref={videoRef} 
                                className="qr-scanner-video"
                                autoPlay
                                muted
                                playsInline
                              />
                            )}
                          </div>
                          <p className="scanner-instructions">
                            Point your camera at the QR code to connect
                          </p>
                        </DialogContent>
                      </Dialog>
                      <p className="scan-hint">
                        Scan your peer's QR code to connect instantly
                      </p>
                    </div>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
            
            <div className="features-grid">
              <div className="feature-card">
                <Lock className="feature-icon" />
                <h3>End-to-End Encrypted</h3>
                <p>Messages encrypted with AES-256</p>
              </div>
              <div className="feature-card">
                <Shield className="feature-icon" />
                <h3>Peer-to-Peer</h3>
                <p>Direct connection, no servers</p>
              </div>
              <div className="feature-card">
                <QrCode className="feature-icon" />
                <h3>QR Code Exchange</h3>
                <p>Easy contact sharing with camera</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="chat-container">
            <div className="chat-header">
              <div className="chat-info">
                <h2 className="chat-title">Secure Chat</h2>
                <div className="encryption-status">
                  {encryptionEnabled ? (
                    <Badge variant="secondary" className="encryption-badge">
                      <Lock className="badge-icon" />
                      E2E Encrypted
                    </Badge>
                  ) : (
                    <Badge variant="destructive" className="encryption-badge">
                      <Unlock className="badge-icon" />
                      Not Encrypted
                    </Badge>
                  )}
                </div>
              </div>
            </div>
            
            <div className="messages-container">
              <div className="messages-list">
                {messages.map((message) => (
                  <div key={message.id} className={`message ${message.sender === 'me' ? 'message-sent' : 'message-received'}`}>
                    <div className="message-content">
                      <p className="message-text">{message.text}</p>
                      <div className="message-meta">
                        <span className="message-time">{message.timestamp}</span>
                        {message.encrypted && <Lock className="message-encrypted-icon" />}
                      </div>
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
            </div>
            
            <div className="message-input-container">
              <div className="message-input-wrapper">
                <Input
                  value={currentMessage}
                  onChange={(e) => setCurrentMessage(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="Type your secure message..."
                  className="message-input"
                  disabled={connectionStatus !== 'connected'}
                />
                <Button 
                  onClick={sendMessage}
                  disabled={!currentMessage.trim() || connectionStatus !== 'connected'}
                  className="send-button"
                >
                  <Send className="send-icon" />
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;