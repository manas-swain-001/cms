const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Attendance = require('../models/Attendance');
const Task = require('../models/Task');

class SocketHandler {
  constructor(io) {
    this.io = io;
    this.connectedUsers = new Map(); // userId -> socket info
    this.setupSocketHandlers();
  }

  setupSocketHandlers() {
    this.io.use(this.authenticateSocket.bind(this));
    
    this.io.on('connection', (socket) => {
      console.log(`User ${socket.user.firstName} connected:`, socket.id);
      
      // Store user connection
      this.connectedUsers.set(socket.user._id.toString(), {
        socketId: socket.id,
        user: socket.user,
        connectedAt: new Date()
      });

      // Join user to their personal room
      socket.join(`user_${socket.user._id}`);
      
      // Join user to their office/department room for team updates
      if (socket.user.office) {
        socket.join(`office_${socket.user.office}`);
      }
      if (socket.user.department) {
        socket.join(`department_${socket.user.department}`);
      }
      
      // Join managers/admins to management room
      if (['admin', 'manager'].includes(socket.user.role)) {
        socket.join('management');
      }

      // Send initial connection data
      socket.emit('connected', {
        message: 'Connected to real-time updates',
        user: {
          id: socket.user._id,
          name: `${socket.user.firstName} ${socket.user.lastName}`,
          role: socket.user.role
        },
        timestamp: new Date()
      });

      // Handle attendance updates
      socket.on('attendance_update', this.handleAttendanceUpdate.bind(this, socket));
      
      // Handle task updates
      socket.on('task_update', this.handleTaskUpdate.bind(this, socket));
      
      // Handle location updates
      socket.on('location_update', this.handleLocationUpdate.bind(this, socket));
      
      // Handle typing indicators for team chat
      socket.on('typing_start', this.handleTypingStart.bind(this, socket));
      socket.on('typing_stop', this.handleTypingStop.bind(this, socket));
      
      // Handle dashboard refresh requests
      socket.on('request_dashboard_update', this.handleDashboardUpdateRequest.bind(this, socket));
      
      // Handle disconnection
      socket.on('disconnect', this.handleDisconnect.bind(this, socket));
    });
  }

  async authenticateSocket(socket, next) {
    try {
      const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');
      
      if (!token) {
        return next(new Error('Authentication token required'));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id).select('-password -refreshTokens');
      
      if (!user || !user.isActive) {
        return next(new Error('User not found or inactive'));
      }

      socket.user = user;
      next();
    } catch (error) {
      console.error('Socket authentication error:', error);
      next(new Error('Authentication failed'));
    }
  }

  async handleAttendanceUpdate(socket, data) {
    try {
      const { type, attendanceData } = data;
      const userId = socket.user._id;

      // Validate attendance update
      if (!['punch_in', 'punch_out', 'break_start', 'break_end'].includes(type)) {
        socket.emit('error', { message: 'Invalid attendance update type' });
        return;
      }

      // Broadcast to user's personal room
      socket.to(`user_${userId}`).emit('attendance_updated', {
        type,
        data: attendanceData,
        timestamp: new Date(),
        user: {
          id: userId,
          name: `${socket.user.firstName} ${socket.user.lastName}`
        }
      });

      // Broadcast to management for real-time monitoring
      this.io.to('management').emit('team_attendance_update', {
        type,
        user: {
          id: userId,
          name: `${socket.user.firstName} ${socket.user.lastName}`,
          role: socket.user.role,
          office: socket.user.office,
          department: socket.user.department
        },
        data: attendanceData,
        timestamp: new Date()
      });

      // Broadcast to office/department for team awareness
      if (socket.user.office) {
        socket.to(`office_${socket.user.office}`).emit('colleague_attendance_update', {
          type,
          user: {
            id: userId,
            name: `${socket.user.firstName} ${socket.user.lastName}`
          },
          timestamp: new Date()
        });
      }

      console.log(`Attendance update broadcasted: ${type} for user ${socket.user.firstName}`);
    } catch (error) {
      console.error('Handle attendance update error:', error);
      socket.emit('error', { message: 'Failed to process attendance update' });
    }
  }

  async handleTaskUpdate(socket, data) {
    try {
      const { taskData, complianceMetrics } = data;
      const userId = socket.user._id;

      // Broadcast to user's personal room
      socket.to(`user_${userId}`).emit('task_updated', {
        data: taskData,
        complianceMetrics,
        timestamp: new Date(),
        user: {
          id: userId,
          name: `${socket.user.firstName} ${socket.user.lastName}`
        }
      });

      // Broadcast to management for monitoring
      this.io.to('management').emit('team_task_update', {
        user: {
          id: userId,
          name: `${socket.user.firstName} ${socket.user.lastName}`,
          role: socket.user.role,
          office: socket.user.office,
          department: socket.user.department
        },
        complianceScore: complianceMetrics?.overallScore || 0,
        completedTasks: complianceMetrics?.completedTasks || 0,
        timestamp: new Date()
      });

      console.log(`Task update broadcasted for user ${socket.user.firstName}`);
    } catch (error) {
      console.error('Handle task update error:', error);
      socket.emit('error', { message: 'Failed to process task update' });
    }
  }

  async handleLocationUpdate(socket, data) {
    try {
      const { latitude, longitude, accuracy, timestamp } = data;
      const userId = socket.user._id;

      // Validate location data
      if (!latitude || !longitude) {
        socket.emit('error', { message: 'Invalid location data' });
        return;
      }

      // Broadcast to management for location monitoring
      this.io.to('management').emit('user_location_update', {
        user: {
          id: userId,
          name: `${socket.user.firstName} ${socket.user.lastName}`,
          role: socket.user.role
        },
        location: {
          latitude,
          longitude,
          accuracy,
          timestamp: timestamp || new Date()
        }
      });

      console.log(`Location update received from user ${socket.user.firstName}`);
    } catch (error) {
      console.error('Handle location update error:', error);
      socket.emit('error', { message: 'Failed to process location update' });
    }
  }

  handleTypingStart(socket, data) {
    const { room } = data;
    if (room && this.isValidRoom(room, socket.user)) {
      socket.to(room).emit('user_typing', {
        user: {
          id: socket.user._id,
          name: `${socket.user.firstName} ${socket.user.lastName}`
        },
        timestamp: new Date()
      });
    }
  }

  handleTypingStop(socket, data) {
    const { room } = data;
    if (room && this.isValidRoom(room, socket.user)) {
      socket.to(room).emit('user_stopped_typing', {
        user: {
          id: socket.user._id,
          name: `${socket.user.firstName} ${socket.user.lastName}`
        },
        timestamp: new Date()
      });
    }
  }

  async handleDashboardUpdateRequest(socket, data) {
    try {
      const { widgets } = data;
      const userId = socket.user._id;

      // Get fresh dashboard data based on requested widgets
      const dashboardData = {};

      if (widgets.includes('attendance')) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const todayAttendance = await Attendance.findOne({
          userId,
          date: today
        });
        
        dashboardData.attendance = {
          status: todayAttendance ? todayAttendance.status : 'absent',
          punchIn: todayAttendance?.punchIn?.time || null,
          punchOut: todayAttendance?.punchOut?.time || null,
          workingHours: todayAttendance?.workSummary?.totalHours || 0
        };
      }

      if (widgets.includes('tasks')) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const todayTasks = await Task.findOne({
          userId,
          date: today
        });
        
        dashboardData.tasks = {
          complianceScore: todayTasks?.complianceMetrics?.overallScore || 0,
          completedTasks: todayTasks?.complianceMetrics?.completedTasks || 0,
          totalTasks: todayTasks?.complianceMetrics?.totalTasks || 15
        };
      }

      socket.emit('dashboard_data_update', {
        widgets,
        data: dashboardData,
        timestamp: new Date()
      });

      console.log(`Dashboard update sent to user ${socket.user.firstName}`);
    } catch (error) {
      console.error('Handle dashboard update request error:', error);
      socket.emit('error', { message: 'Failed to fetch dashboard update' });
    }
  }

  handleDisconnect(socket) {
    const userId = socket.user._id.toString();
    this.connectedUsers.delete(userId);
    
    console.log(`User ${socket.user.firstName} disconnected:`, socket.id);
    
    // Notify management about user disconnection
    this.io.to('management').emit('user_disconnected', {
      user: {
        id: socket.user._id,
        name: `${socket.user.firstName} ${socket.user.lastName}`,
        role: socket.user.role
      },
      timestamp: new Date()
    });
  }

  isValidRoom(room, user) {
    // Validate if user can join/send to specific rooms
    const validRooms = [
      `user_${user._id}`,
      `office_${user.office}`,
      `department_${user.department}`
    ];
    
    if (['admin', 'manager'].includes(user.role)) {
      validRooms.push('management');
    }
    
    return validRooms.includes(room);
  }

  // Public methods for external use
  broadcastToUser(userId, event, data) {
    this.io.to(`user_${userId}`).emit(event, data);
  }

  broadcastToOffice(office, event, data) {
    this.io.to(`office_${office}`).emit(event, data);
  }

  broadcastToManagement(event, data) {
    this.io.to('management').emit(event, data);
  }

  broadcastToAll(event, data) {
    this.io.emit(event, data);
  }

  getConnectedUsers() {
    return Array.from(this.connectedUsers.values());
  }

  isUserConnected(userId) {
    return this.connectedUsers.has(userId.toString());
  }

  // Notification system
  async sendNotification(userId, notification) {
    try {
      const notificationData = {
        id: Date.now().toString(),
        type: notification.type || 'info',
        title: notification.title,
        message: notification.message,
        data: notification.data || {},
        timestamp: new Date(),
        read: false
      };

      // Send to specific user
      this.broadcastToUser(userId, 'notification', notificationData);
      
      // Store notification in database (you might want to create a Notification model)
      console.log(`Notification sent to user ${userId}:`, notification.title);
      
      return notificationData;
    } catch (error) {
      console.error('Send notification error:', error);
      throw error;
    }
  }

  // System alerts
  async sendSystemAlert(alert) {
    try {
      const alertData = {
        id: Date.now().toString(),
        type: alert.type || 'warning',
        title: alert.title,
        message: alert.message,
        severity: alert.severity || 'medium',
        timestamp: new Date()
      };

      // Send to all management
      this.broadcastToManagement('system_alert', alertData);
      
      console.log('System alert broadcasted:', alert.title);
      
      return alertData;
    } catch (error) {
      console.error('Send system alert error:', error);
      throw error;
    }
  }
}

module.exports = SocketHandler;