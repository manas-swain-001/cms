const express = require('express');
const { body, validationResult, query } = require('express-validator');
const Attendance = require('../models/Attendance');
const { User } = require('../models/User');
const { Task } = require('../models/Task');
const { auth, authorize, managerAccess, auditLog } = require('../middleware/auth');
const { USER_ROLES, ATTENDANCE_STATUS } = require('../constant/enum');

const router = express.Router();

// @route   POST /api/attendance/punch-in
// @desc    Punch in for work
// @access  Private
router.post('/punch-in', [
  auth,
  body('location.latitude')
    .isFloat({ min: -90, max: 90 })
    .withMessage('Latitude must be between -90 and 90'),
  body('location.longitude')
    .isFloat({ min: -180, max: 180 })
    .withMessage('Longitude must be between -180 and 180'),
  body('notes')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Notes must not exceed 500 characters'),
  auditLog('PUNCH_IN')
], async (req, res) => {
  try {

    console.log(req?.header)

    // return 0;
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const userId = req.user._id;
    const { location, notes } = req.body;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Check if user already punched in today and has an active session
    const existingAttendance = await Attendance.findOne({
      userId,
      date: today
    });

    // Check if there's an active session (check-in without check-out)
    const hasActiveSession = existingAttendance?.sessions?.some(session =>
      session.checkIn?.time && !session.checkOut?.time
    );

    if (hasActiveSession) {
      return res.status(400).json({
        success: false,
        message: 'You have an active session. Please punch out first.'
      });
    }

    console.log('Punch in :::: ', new Date());

    // Create new attendance record or update existing one
    let attendance;
    const newSession = {
      checkIn: {
        time: new Date(),
        location,
        method: 'manual',
        deviceInfo: {
          userAgent: req.get('User-Agent'),
          ipAddress: req.ip,
        },
        isLate: false,
        lateMinutes: 0
      }
    };

    // Check if user is late (assuming 9 AM is standard start time)
    const now = new Date();
    const standardStartTime = new Date(today);
    standardStartTime.setHours(9, 0, 0, 0);

    if (now > standardStartTime) {
      newSession.checkIn.isLate = true;
      newSession.checkIn.lateMinutes = Math.round((now - standardStartTime) / (1000 * 60));
    }

    if (existingAttendance) {
      // Add new session to existing record
      attendance = await Attendance.findByIdAndUpdate(
        existingAttendance._id,
        {
          $push: { sessions: newSession },
          status: 'present'
        },
        { new: true }
      );
    } else {
      // Create new attendance record
      attendance = new Attendance({
        userId,
        date: today,
        sessions: [newSession],
        status: 'present'
      });
      attendance = await attendance.save();
    }

    // Get user details for response
    const user = await User.findById(userId);
    if (user) {
      attendance.userId = {
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
        office: user.office
      };
    }

    // Silently create task with scheduled entries based on punch-in time
    try {
      const punchInTime = newSession.checkIn.time;
      const punchInTimeString = punchInTime.toTimeString().slice(0, 5); // Format as HH:MM

      // Create task with scheduled entries
      await Task.createTaskWithPunchIn(userId, punchInTimeString);
      console.log(`📋 Task created for user ${userId} with punch-in time ${punchInTimeString}`);
    } catch (taskError) {
      // Log error but don't fail the punch-in
      console.error('❌ Error creating task during punch-in:', taskError.message);
    }

    res.json({
      success: true,
      message: 'Punched in successfully',
      data: { attendance }
    });
  } catch (error) {
    console.error('Punch in error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during punch in'
    });
  }
});

// @route   POST /api/attendance/punch-out
// @desc    Punch out from work
// @access  Private
router.post('/punch-out', [
  auth,
  body('location.latitude')
    .isFloat({ min: -90, max: 90 })
    .withMessage('Latitude must be between -90 and 90'),
  body('location.longitude')
    .isFloat({ min: -180, max: 180 })
    .withMessage('Longitude must be between -180 and 180'),
  body('notes')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Notes must not exceed 500 characters'),
  auditLog('PUNCH_OUT')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const userId = req.user._id;
    const { location, notes } = req.body;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Find today's attendance record
    const attendance = await Attendance.findOne({
      userId,
      date: today
    });

    if (!attendance || !attendance.sessions || attendance.sessions.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No punch-in record found for today. Please punch in first.'
      });
    }

    // Find the active session (check-in without check-out)
    const activeSessionIndex = attendance.sessions.findIndex(session =>
      session.checkIn?.time && !session.checkOut?.time
    );

    if (activeSessionIndex === -1) {
      return res.status(400).json({
        success: false,
        message: 'No active session found. Please punch in first.'
      });
    }

    // Update the active session with check-out
    const activeSession = attendance.sessions[activeSessionIndex];
    activeSession.checkOut = {
      time: new Date(),
      location,
      method: 'manual',
      deviceInfo: {
        userAgent: req.get('User-Agent'),
        ipAddress: req.ip,
      },
      isEarly: false,
      earlyMinutes: 0
    };

    // Calculate session duration
    const sessionDuration = activeSession.checkOut.time - activeSession.checkIn.time;
    activeSession.duration = Math.round((sessionDuration / (1000 * 60)) * 100) / 100; // Duration in minutes

    // Check if user is leaving early (assuming 6 PM is standard end time)
    const now = new Date();
    const standardEndTime = new Date(today);
    standardEndTime.setHours(18, 0, 0, 0);

    if (now < standardEndTime) {
      activeSession.checkOut.isEarly = true;
      activeSession.checkOut.earlyMinutes = Math.round((standardEndTime - now) / (1000 * 60));
    }

    // Update the attendance record
    attendance.sessions[activeSessionIndex] = activeSession;

    // Recalculate work summary
    attendance.calculateWorkSummary();

    // Determine overall status based on total work hours
    const minWorkHours = 8; // Configurable
    if (attendance.workSummary.effectiveHours >= minWorkHours) {
      attendance.status = 'present';
    } else {
      attendance.status = 'partial';
    }

    await attendance.save();

    // Get user details for response
    const user = await User.findById(userId);
    if (user) {
      attendance.userId = {
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
        office: user.office
      };
    }

    res.json({
      success: true,
      message: 'Punched out successfully',
      data: { attendance }
    });
  } catch (error) {
    console.error('Punch out error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during punch out'
    });
  }
});

// @route   POST /api/attendance/break-start
// @desc    Start break
// @access  Private
router.post('/break-start', [
  auth,
  body('breakType')
    .isIn(['lunch', 'tea', 'personal', 'meeting'])
    .withMessage('Invalid break type'),
  body('notes')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Notes must not exceed 500 characters'),
  auditLog('BREAK_START')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const userId = req.user._id;
    const { breakType, notes } = req.body;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Find today's attendance record
    const attendance = await Attendance.findOne({
      userId,
      date: today
    });

    if (!attendance || !attendance.sessions || attendance.sessions.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Please punch in first before taking a break.'
      });
    }

    // Check if there's an active session (check-in without check-out)
    const hasActiveSession = attendance.sessions.some(session =>
      session.checkIn?.time && !session.checkOut?.time
    );

    if (!hasActiveSession) {
      return res.status(400).json({
        success: false,
        message: 'You must be punched in to take a break.'
      });
    }

    // Check if there's an ongoing break
    const ongoingBreak = attendance.breaks.find(b => b.startTime && !b.endTime);
    if (ongoingBreak) {
      return res.status(400).json({
        success: false,
        message: 'You already have an ongoing break. Please end it first.'
      });
    }

    // Add new break
    const newBreak = {
      type: breakType,
      startTime: new Date(),
      notes: notes || ''
    };

    attendance.breaks.push(newBreak);

    await attendance.save();

    res.json({
      success: true,
      message: 'Break started successfully',
      data: {
        breakType,
        startTime: new Date()
      }
    });
  } catch (error) {
    console.error('Break start error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during break start'
    });
  }
});

// @route   POST /api/attendance/break-end
// @desc    End break
// @access  Private
router.post('/break-end', [
  auth,
  body('notes')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Notes must not exceed 500 characters'),
  auditLog('BREAK_END')
], async (req, res) => {
  try {
    const userId = req.user._id;
    const { notes } = req.body;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Find today's attendance record
    const attendance = await Attendance.findOne({
      userId,
      date: today
    });

    if (!attendance) {
      return res.status(400).json({
        success: false,
        message: 'No attendance record found for today.'
      });
    }

    // Find ongoing break
    const ongoingBreak = attendance.breaks.find(b => b.startTime && !b.endTime);
    if (!ongoingBreak) {
      return res.status(400).json({
        success: false,
        message: 'No ongoing break found.'
      });
    }

    // End the break
    ongoingBreak.endTime = new Date();
    ongoingBreak.duration = Math.round(
      ((ongoingBreak.endTime - ongoingBreak.startTime) / (1000 * 60)) * 100
    ) / 100; // Duration in minutes

    if (notes) {
      ongoingBreak.notes = (ongoingBreak.notes || '') + ' ' + notes;
    }

    // Recalculate work summary
    attendance.calculateWorkSummary();

    await attendance.save();

    res.json({
      success: true,
      message: 'Break ended successfully',
      data: {
        breakType: ongoingBreak.type,
        duration: ongoingBreak.duration,
        totalBreakTime: attendance.workSummary.breakTime
      }
    });
  } catch (error) {
    console.error('Break end error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during break end'
    });
  }
});

// @route   GET /api/attendance/today
// @desc    Get today's attendance status
// @access  Private
router.get('/today', auth, async (req, res) => {
  try {
    const userId = req.user._id;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const attendance = await Attendance.findOne({
      userId,
      date: today
    });

    // Get user details if attendance exists
    if (attendance) {
      const user = await User.findById(userId);
      if (user) {
        attendance.userId = {
          _id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          role: user.role,
          office: user.office
        };
      }
    }

    if (!attendance) {
      return res.json({
        success: true,
        data: {
          attendance: null,
          status: 'not_punched_in',
          message: 'No attendance record for today'
        }
      });
    }

    // Determine current status
    let currentStatus = 'not_punched_in';
    let ongoingBreak = null;
    let activeSession = null;

    // Check if there's an active session (check-in without check-out)
    const activeSessionIndex = attendance.sessions?.findIndex(session =>
      session.checkIn?.time && !session.checkOut?.time
    );

    if (activeSessionIndex !== -1 && activeSessionIndex !== undefined) {
      activeSession = attendance.sessions[activeSessionIndex];
      const activeBreak = attendance.breaks?.find(b => b.startTime && !b.endTime);
      if (activeBreak) {
        currentStatus = 'on_break';
        ongoingBreak = activeBreak;
      } else {
        currentStatus = 'working';
      }
    } else if (attendance.sessions && attendance.sessions.length > 0) {
      // Check if all sessions are completed
      const allSessionsCompleted = attendance.sessions.every(session =>
        session.checkIn?.time && session.checkOut?.time
      );
      if (allSessionsCompleted) {
        currentStatus = 'punched_out';
      }
    }

    res.json({
      success: true,
      data: {
        attendance,
        currentStatus,
        activeSession,
        ongoingBreak,
        workingHours: attendance?.workSummary?.totalHours || 0,
        breakTime: attendance?.workSummary?.totalBreakTime || 0,
        effectiveHours: attendance?.workSummary?.effectiveHours || 0,
        totalSessions: attendance?.sessions?.length || 0
      }
    });
  } catch (error) {
    console.error('Get today attendance error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching today\'s attendance'
    });
  }
});

// @route   GET /api/attendance/history
// @desc    Get attendance history with pagination
// @access  Private
router.get('/history', [
  auth,
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
  query('startDate').optional().isISO8601().withMessage('Start date must be a valid date'),
  query('endDate').optional().isISO8601().withMessage('End date must be a valid date')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const {
      page = 1,
      limit = 10,
      startDate,
      endDate,
      status
    } = req.query;

    const userId = req.user._id;

    // Build filter
    const filter = { userId };

    if (startDate || endDate) {
      filter.date = {};
      if (startDate) filter.date.$gte = new Date(startDate);
      if (endDate) filter.date.$lte = new Date(endDate);
    }

    if (status) {
      filter.status = status;
    }

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Execute query with proper pagination
    const total = await Attendance.countDocuments(filter);

    const attendanceRecords = await Attendance.find(filter)
      .sort({ date: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate('userId', 'firstName lastName email role office department');

    // Process records to include user details and session information
    const processedRecords = attendanceRecords.map(record => {
      const recordObj = record.toObject();

      // Add session summary
      recordObj.sessionSummary = {
        totalSessions: record.sessions?.length || 0,
        completedSessions: record.sessions?.filter(s => s.checkIn?.time && s.checkOut?.time).length || 0,
        activeSessions: record.sessions?.filter(s => s.checkIn?.time && !s.checkOut?.time).length || 0,
        firstCheckIn: record.sessions?.[0]?.checkIn?.time || null,
        lastCheckOut: record.sessions?.slice().reverse().find(s => s.checkOut?.time)?.checkOut?.time || null
      };

      return recordObj;
    });

    // Calculate pagination info
    const totalPages = Math.ceil(total / parseInt(limit));

    res.json({
      success: true,
      data: {
        attendanceRecords: processedRecords,
        pagination: {
          currentPage: parseInt(page),
          totalPages,
          totalRecords: total,
          hasNextPage: parseInt(page) < totalPages,
          hasPrevPage: parseInt(page) > 1,
          limit: parseInt(limit)
        }
      }
    });
  } catch (error) {
    console.error('Get attendance history error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching attendance history'
    });
  }
});

// @route   GET /api/attendance/team
// @desc    Get team attendance (for managers)
// @access  Private (Manager/Admin)
router.get('/team', [
  auth,
  authorize(USER_ROLES.ADMIN, USER_ROLES.MANAGER),
  query('date').optional().isISO8601().withMessage('Date must be a valid date')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { date = new Date().toISOString().split('T')[0] } = req.query;
    const targetDate = new Date(date);
    targetDate.setHours(0, 0, 0, 0);

    // Build filter based on user role
    const userFilter = {};
    if (req.user.role === USER_ROLES.MANAGER) {
      userFilter.office = req.user.office;
      userFilter.department = req.user.department;
    }

    // Get team members
    const teamMembers = await User.find({
      ...userFilter,
      isActive: true,
      _id: { $ne: req.user._id } // Exclude self
    }).select('firstName lastName email role office department');

    // Get attendance for team members
    const teamIds = teamMembers.map(member => member._id);
    const attendanceRecords = await Attendance.find({
      userId: { $in: teamIds },
      date: targetDate
    }).populate('userId', 'firstName lastName email role office department');

    // Combine team members with their attendance
    const teamAttendance = teamMembers.map(member => {
      const attendance = attendanceRecords.find(
        record => record.userId._id.toString() === member._id.toString()
      );

      let status = 'absent';
      let firstCheckIn = null;
      let lastCheckOut = null;
      let totalSessions = 0;
      let activeSessions = 0;

      if (attendance) {
        status = attendance.status;
        totalSessions = attendance.sessions?.length || 0;
        activeSessions = attendance.sessions?.filter(s => s.checkIn?.time && !s.checkOut?.time).length || 0;
        firstCheckIn = attendance.sessions?.[0]?.checkIn?.time || null;
        lastCheckOut = attendance.sessions?.slice().reverse().find(s => s.checkOut?.time)?.checkOut?.time || null;
      }

      return {
        user: member,
        attendance: attendance || null,
        status,
        workingHours: attendance?.workSummary?.totalHours || 0,
        effectiveHours: attendance?.workSummary?.effectiveHours || 0,
        firstCheckIn,
        lastCheckOut,
        totalSessions,
        activeSessions
      };
    });

    // Calculate summary
    const summary = {
      totalTeamMembers: teamMembers.length,
      present: teamAttendance.filter(ta => ta.status === 'present').length,
      partial: teamAttendance.filter(ta => ta.status === 'partial').length,
      absent: teamAttendance.filter(ta => ta.status === 'absent').length,
      late: teamAttendance.filter(ta => {
        if (!ta.attendance || !ta.firstCheckIn) return false;
        const punchInTime = new Date(ta.firstCheckIn);
        const expectedTime = new Date(targetDate);
        expectedTime.setHours(9, 0, 0, 0); // 9 AM expected time
        return punchInTime > expectedTime;
      }).length,
      activeSessions: teamAttendance.reduce((sum, ta) => sum + ta.activeSessions, 0),
      totalSessions: teamAttendance.reduce((sum, ta) => sum + ta.totalSessions, 0)
    };

    res.json({
      success: true,
      data: {
        date: targetDate,
        teamAttendance,
        summary
      }
    });
  } catch (error) {
    console.error('Get team attendance error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching team attendance'
    });
  }
});

// @route   GET /api/attendance/reports/summary
// @desc    Get attendance summary report
// @access  Private (Manager/Admin)
router.get('/reports/summary', [
  auth,
  authorize(USER_ROLES.ADMIN, USER_ROLES.MANAGER),
  query('startDate').isISO8601().withMessage('Start date is required and must be valid'),
  query('endDate').isISO8601().withMessage('End date is required and must be valid'),
  query('userId').optional().isMongoId().withMessage('Invalid user ID')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { startDate, endDate, userId } = req.query;

    // Build filter
    const filter = {
      date: {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      }
    };

    // Role-based filtering
    if (req.user.role === USER_ROLES.MANAGER) {
      const teamMembers = await User.find({
        office: req.user.office,
        department: req.user.department,
        isActive: true
      }).select('_id');

      filter.userId = { $in: teamMembers.map(user => user._id) };
    }

    if (userId) {
      filter.userId = userId;
    }

    // Get attendance summary
    const summary = await Attendance.getAttendanceSummary(filter.userId, new Date(startDate), new Date(endDate));

    res.json({
      success: true,
      data: {
        period: { startDate, endDate },
        summary
      }
    });
  } catch (error) {
    console.error('Get attendance summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while generating attendance summary'
    });
  }
});

// @route   PUT /api/attendance/:id/approve
// @desc    Approve attendance record
// @access  Private (Manager/Admin)
router.put('/:id/approve', [
  auth,
  authorize(USER_ROLES.ADMIN, USER_ROLES.MANAGER),
  body('notes').optional().trim().isLength({ max: 500 }).withMessage('Notes must not exceed 500 characters'),
  auditLog('APPROVE_ATTENDANCE')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const attendanceId = req.params.id;
    const { notes } = req.body;

    const attendance = await Attendance.findById(attendanceId).populate('userId', 'firstName lastName email office department');

    if (!attendance) {
      return res.status(404).json({
        success: false,
        message: 'Attendance record not found'
      });
    }

    // Check if manager can approve this attendance
    if (req.user.role === USER_ROLES.MANAGER) {
      if (attendance.userId.office !== req.user.office ||
        attendance.userId.department !== req.user.department) {
        return res.status(403).json({
          success: false,
          message: 'You can only approve attendance for your team members'
        });
      }
    }

    // Update approval status
    const updatedAttendance = await Attendance.findByIdAndUpdate(attendanceId, {
      isValidated: true,
      validatedBy: req.user._id,
      validatedAt: new Date(),
      notes: notes || ''
    }, { new: true }).populate('userId', 'firstName lastName email office department');

    if (!updatedAttendance) {
      return res.status(404).json({
        success: false,
        message: 'Failed to update attendance record'
      });
    }

    res.json({
      success: true,
      message: 'Attendance approved successfully',
      data: { attendance: updatedAttendance }
    });
  } catch (error) {
    console.error('Approve attendance error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while approving attendance'
    });
  }
});

// @route   GET /api/attendance/sessions/:id
// @desc    Get detailed session information
// @access  Private
router.get('/sessions/:id', auth, async (req, res) => {
  try {
    const attendanceId = req.params.id;
    const userId = req.user._id;

    const attendance = await Attendance.findOne({
      _id: attendanceId,
      userId
    }).populate('userId', 'firstName lastName email role office department');

    if (!attendance) {
      return res.status(404).json({
        success: false,
        message: 'Attendance record not found'
      });
    }

    // Get session summary
    const sessionSummary = attendance.getSessionSummary();
    const activeSession = attendance.getActiveSession();
    const completedSessions = attendance.getCompletedSessions();

    res.json({
      success: true,
      data: {
        attendance,
        sessionSummary,
        activeSession,
        completedSessions,
        isCurrentlyWorking: attendance.isCurrentlyWorking(),
        isOnBreak: attendance.isOnBreak()
      }
    });
  } catch (error) {
    console.error('Get session details error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching session details'
    });
  }
});

// @route   GET /api/attendance/stats
// @desc    Get attendance statistics for user
// @access  Private
router.get('/stats', [
  auth,
  query('startDate').optional().isISO8601().withMessage('Start date must be a valid date'),
  query('endDate').optional().isISO8601().withMessage('End date must be a valid date')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const userId = req.user._id;
    const { startDate, endDate } = req.query;

    // Default to last 30 days if no dates provided
    const end = endDate ? new Date(endDate) : new Date();
    const start = startDate ? new Date(startDate) : new Date();
    start.setDate(start.getDate() - 30);

    const stats = await Attendance.getAttendanceStats(userId, start, end);

    res.json({
      success: true,
      data: {
        period: { startDate: start, endDate: end },
        stats
      }
    });
  } catch (error) {
    console.error('Get attendance stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching attendance statistics'
    });
  }
});

module.exports = router;