const express = require('express');
const { body, validationResult, query } = require('express-validator');
const Attendance = require('../models/Attendance');
const { User } = require('../models/User');
const { auth, authorize, managerAccess, auditLog } = require('../middleware/auth');

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
  body('location.address')
    .optional()
    .trim()
    .isLength({ max: 200 })
    .withMessage('Address must not exceed 200 characters'),
  auditLog('PUNCH_IN')
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

    // Check if user already punched in today
    const existingAttendance = await Attendance.findOne({
      userId,
      date: today,
      status: ['present', 'partial']
    });

    if (existingAttendance && existingAttendance.checkIn && !existingAttendance.checkOut) {
      return res.status(400).json({
        success: false,
        message: 'You have already punched in today. Please punch out first.'
      });
    }

    // Create new attendance record or update existing one
    let attendance;
    
    if (existingAttendance) {
      // Update existing record (in case of multiple punch-ins after punch-out)
      attendance = await Attendance.findByIdAndUpdate(existingAttendance._id, {
        checkIn: {
          time: new Date(),
          location,
          notes,
          method: 'manual' // Could be 'biometric', 'qr', etc.
        },
        status: 'present'
      }, { new: true });
    } else {
      // Create new attendance record
      attendance = new Attendance({
        userId,
        date: today,
        checkIn: {
          time: new Date(),
          location,
          notes,
          method: 'manual'
        },
        status: 'present',
        office: req.user.office
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
  body('location.address')
    .optional()
    .trim()
    .isLength({ max: 200 })
    .withMessage('Address must not exceed 200 characters'),
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
      date: today,
      status: ['present', 'partial']
    });

    if (!attendance || !attendance.checkIn) {
      return res.status(400).json({
        success: false,
        message: 'No punch-in record found for today. Please punch in first.'
      });
    }

    if (attendance.punchOut) {
      return res.status(400).json({
        success: false,
        message: 'You have already punched out today.'
      });
    }

    // Update attendance with punch out
    attendance.checkOut = {
      time: new Date(),
      location,
      notes,
      method: 'manual'
    };

    // Calculate work duration
    const workDuration = attendance.checkOut.time - attendance.checkIn.time;
    attendance.workSummary.totalHours = Math.round((workDuration / (1000 * 60 * 60)) * 100) / 100;
    
    // Determine status based on work hours
    const minWorkHours = 8; // Configurable
    if (attendance.workSummary.totalHours >= minWorkHours) {
      attendance.status = 'present';
    } else {
      attendance.status = 'partial';
    }

    await Attendance.findByIdAndUpdate(attendance._id, {
      checkOut: attendance.checkOut,
      workSummary: attendance.workSummary,
      status: attendance.status
    });

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
    const attendance = Attendance.findOne({
      userId,
      date: today,
      status: ['present', 'partial']
    });

    if (!attendance || !attendance.checkIn) {
      return res.status(400).json({
        success: false,
        message: 'Please punch in first before taking a break.'
      });
    }

    if (attendance.checkOut) {
      return res.status(400).json({
        success: false,
        message: 'Cannot start break after punching out.'
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
    attendance.breaks.push({
      type: breakType,
      startTime: new Date(),
      notes
    });

    Attendance.findByIdAndUpdate(attendance._id, {
      breaks: attendance.breaks
    });

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
  auditLog('BREAK_END')
], async (req, res) => {
  try {
    const userId = req.user._id;
    const { notes } = req.body;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Find today's attendance record
    const attendance = Attendance.findOne({
      userId,
      date: today,
      status: ['present', 'partial']
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

    // Update total break time
    attendance.workSummary.breakTime = attendance.breaks
      .filter(b => b.duration)
      .reduce((total, b) => total + b.duration, 0);

    Attendance.findByIdAndUpdate(attendance._id, {
      breaks: attendance.breaks,
      workSummary: attendance.workSummary
    });

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

    const attendance = Attendance.findOne({
      userId,
      date: today
    });
    
    // Get user details if attendance exists
    if (attendance) {
      const user = User.findById(userId);
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
    
    if (attendance.punchIn && !attendance.punchOut) {
      const activeBreak = attendance.breaks.find(b => b.startTime && !b.endTime);
      if (activeBreak) {
        currentStatus = 'on_break';
        ongoingBreak = activeBreak;
      } else {
        currentStatus = 'working';
      }
    } else if (attendance.punchIn && attendance.punchOut) {
      currentStatus = 'punched_out';
    }

    res.json({
      success: true,
      data: {
        attendance,
        currentStatus,
        ongoingBreak,
        workingHours: attendance?.workSummary?.totalHours || 0,
        breakTime: attendance?.workSummary?.breakTime || 0
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

    // Execute query
    const allRecords = Attendance.find(filter);
    const total = allRecords.length;
    
    // Apply sorting
    allRecords.sort((a, b) => new Date(b.date) - new Date(a.date));
    
    // Apply pagination
    const attendanceRecords = allRecords.slice(skip, skip + parseInt(limit)).map(record => {
      const user = User.findById(record.userId);
      if (user) {
        record.userId = {
          _id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email
        };
      }
      return record;
    });

    // Calculate pagination info
    const totalPages = Math.ceil(total / parseInt(limit));

    res.json({
      success: true,
      data: {
        attendanceRecords,
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
  authorize('admin', 'manager'),
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
    if (req.user.role === 'manager') {
      userFilter.office = req.user.office;
      userFilter.department = req.user.department;
    }

    // Get team members
    const teamMembers = User.find({
      ...userFilter,
      isActive: true
    }).filter(user => user._id !== req.user._id) // Exclude self
      .map(user => ({
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
        office: user.office,
        department: user.department
      }));

    // Get attendance for team members
    const teamIds = teamMembers.map(member => member._id);
    const attendanceRecords = Attendance.find({
      userId: teamIds,
      date: targetDate
    }).map(record => {
      const user = User.findById(record.userId);
      if (user) {
        record.userId = {
          _id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          role: user.role
        };
      }
      return record;
    });

    // Combine team members with their attendance
    const teamAttendance = teamMembers.map(member => {
      const attendance = attendanceRecords.find(
        record => record.userId._id.toString() === member._id.toString()
      );
      
      return {
        user: member,
        attendance: attendance || null,
        status: attendance ? attendance.status : 'absent',
        workingHours: attendance ? attendance.workSummary.totalHours : 0,
        punchInTime: attendance && attendance.punchIn ? attendance.punchIn.time : null,
        punchOutTime: attendance && attendance.punchOut ? attendance.punchOut.time : null
      };
    });

    // Calculate summary
    const summary = {
      totalTeamMembers: teamMembers.length,
      present: teamAttendance.filter(ta => ta.status === 'present').length,
      partial: teamAttendance.filter(ta => ta.status === 'partial').length,
      absent: teamAttendance.filter(ta => ta.status === 'absent').length,
      late: teamAttendance.filter(ta => {
        if (!ta.attendance || !ta.attendance.punchIn) return false;
        const punchInTime = new Date(ta.attendance.punchIn.time);
        const expectedTime = new Date(targetDate);
        expectedTime.setHours(9, 0, 0, 0); // 9 AM expected time
        return punchInTime > expectedTime;
      }).length
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
  authorize('admin', 'manager'),
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
    if (req.user.role === 'manager') {
      const teamMembers = User.find({
        office: req.user.office,
        department: req.user.department,
        isActive: true
      }).map(user => user._id);
      
      filter.userId = teamMembers;
    }

    if (userId) {
      filter.userId = userId;
    }

    // Get attendance summary
    const summary = Attendance.getAttendanceSummary(filter);

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
  authorize('admin', 'manager'),
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

    const attendance = Attendance.findById(attendanceId);
    
    if (attendance) {
      const user = User.findById(attendance.userId);
      if (user) {
        attendance.userId = {
          _id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          office: user.office,
          department: user.department
        };
      }
    }

    if (!attendance) {
      return res.status(404).json({
        success: false,
        message: 'Attendance record not found'
      });
    }

    // Check if manager can approve this attendance
    if (req.user.role === 'manager') {
      if (attendance.userId.office !== req.user.office || 
          attendance.userId.department !== req.user.department) {
        return res.status(403).json({
          success: false,
          message: 'You can only approve attendance for your team members'
        });
      }
    }

    // Update approval status
    const updatedAttendance = Attendance.findByIdAndUpdate(attendanceId, {
      approval: {
        status: 'approved',
        approvedBy: req.user._id,
        approvedAt: new Date(),
        notes
      }
    });
    
    if (!updatedAttendance) {
      return res.status(404).json({
        success: false,
        message: 'Failed to update attendance record'
      });
    }

    res.json({
      success: true,
      message: 'Attendance approved successfully',
      data: { attendance }
    });
  } catch (error) {
    console.error('Approve attendance error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while approving attendance'
    });
  }
});

module.exports = router;