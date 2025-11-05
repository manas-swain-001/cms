const express = require('express');
const { body, validationResult, query } = require('express-validator');
const ExcelJS = require('exceljs');
const Attendance = require('../models/Attendance');
const { User } = require('../models/User');
const Task = require('../models/Task');
const { auth, authorize, managerAccess, auditLog } = require('../middleware/auth');
const { USER_ROLES, ATTENDANCE_STATUS, WORK_LOCATION } = require('../constant/enum');
const { calculateDistance, formatDistance } = require('../utils/functions');
const {
  getCurrentISTTime,
  getISTStartOfDay,
  getISTEndOfDay,
  parseDateDDMMYYYY,
  getCurrentISTHourMinute,
  getTodayIST
} = require('../utils/dateUtils');

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
    const today = getTodayIST();

    // Check if current time is after 5:30 PM IST
    const { hour: currentHour, minute: currentMinute } = getCurrentISTHourMinute();
    const currentTotalMinutes = currentHour * 60 + currentMinute;
    const cutoffTime = 17 * 60 + 30; // 5:30 PM = 17:30 in 24-hour format

    if (currentTotalMinutes > cutoffTime) {
      return res.status(400).json({
        success: false,
        message: 'Check-in not allowed after 5:30 PM. Please contact your manager if you need to mark attendance.',
        currentTime: `${currentHour.toString().padStart(2, '0')}:${currentMinute.toString().padStart(2, '0')}`
      });
    }

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

    // Calculate GPS distance from office
    const distanceInMeters = calculateDistance(location);
    const formattedDistance = formatDistance(distanceInMeters);
    const withinRadius = distanceInMeters <= 1000; // Within 1km

    // Determine if this is the first check-in of the day
    const isFirstCheckIn = !existingAttendance || existingAttendance.sessions.length === 0;

    // Determine work location based on first check-in location
    let workLocation = WORK_LOCATION.OFFICE;
    if (isFirstCheckIn && !withinRadius) {
      workLocation = WORK_LOCATION.HOME;
    } else if (existingAttendance?.workLocation) {
      // If already set, keep the existing work location
      workLocation = existingAttendance.workLocation;
    }

    // Create tasks for first check-in of the day
    if (isFirstCheckIn) {
      try {
        console.log('First check-in detected, creating update tasks...');
        const currentTime = getCurrentISTTime();
        const { hour: currentHour, minute: currentMinute } = getCurrentISTHourMinute();
        const currentTotalMinutes = currentHour * 60 + currentMinute;

        console.log(`Current time: ${currentHour}:${currentMinute} (${currentTotalMinutes} minutes)`);

        // Define scheduled update times
        const scheduledTimes = ['10:30', '12:00', '13:30', '16:00', '17:30'];
        const tasksToCreate = [];

        // Create tasks for times that haven't passed yet
        for (const timeSlot of scheduledTimes) {
          const [hour, minute] = timeSlot.split(':').map(Number);
          const slotTotalMinutes = hour * 60 + minute;

          console.log(`Checking time slot ${timeSlot} (${slotTotalMinutes} minutes): ${currentTotalMinutes < slotTotalMinutes ? 'INCLUDE' : 'SKIP'}`);

          // Only create task if the time hasn't passed yet
          if (currentTotalMinutes < slotTotalMinutes) {
            tasksToCreate.push({
              scheduledTime: timeSlot,
              status: 'pending',
              description: '',
              createdAt: new Date()
            });
          }
        }

        console.log(`Tasks to create: ${tasksToCreate.length}`, tasksToCreate.map(t => t.scheduledTime));

        // Check if task record already exists for today
        const existingTask = await Task.findOne({
          userId: userId,
          date: today
        });

        console.log(`Existing task found: ${existingTask ? 'YES' : 'NO'}`);

        if (existingTask) {
          // Update existing task with new scheduled entries
          existingTask.scheduledEntries.push(...tasksToCreate);
          await existingTask.save();
          console.log(`Added ${tasksToCreate.length} update tasks for user ${userId}`);
        } else if (tasksToCreate.length > 0) {
          // Create new task record with scheduled entries
          const newTask = new Task({
            userId: userId,
            date: today,
            scheduledEntries: tasksToCreate
          });
          await newTask.save();
          console.log(`Created ${tasksToCreate.length} update tasks for user ${userId}`);
        } else {
          console.log('No tasks to create (all time slots have passed)');
        }
      } catch (taskError) {
        console.error('Error creating update tasks (continuing anyway):', taskError.message);
        console.error('Full error:', taskError);
        // Don't fail check-in if task creation fails
      }
    } else {
      console.log('Not first check-in, skipping task creation');
    }

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
        lateMinutes: 0,
        gpsValidation: {
          distanceFromOffice: formattedDistance,
          withinRadius: withinRadius
        }
      }
    };

    // Check if user is late (office hours: 9:00 AM to 5:30 PM IST)
    const now = getCurrentISTTime();
    const standardStartTime = getISTStartOfDay();
    standardStartTime.setHours(9, 15, 0, 0); // 9:15 AM IST

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
          workLocation: workLocation
        },
        { new: true }
      );
    } else {
      // Create new attendance record
      attendance = new Attendance({
        userId,
        date: today,
        sessions: [newSession],
        status: ATTENDANCE_STATUS.PRESENT,
        workLocation: workLocation
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
    const today = getTodayIST();

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

    // Calculate GPS distance from office
    const distanceInMeters = calculateDistance(location);
    const formattedDistance = formatDistance(distanceInMeters);
    const withinRadius = distanceInMeters <= 1000; // Within 1km

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
      earlyMinutes: 0,
      gpsValidation: {
        distanceFromOffice: formattedDistance,
        withinRadius: withinRadius
      }
    };

    // Recalculate work summary
    attendance.calculateWorkSummary();

    // Determine attendance status based on total work hours
    const minWorkHours = 8; // Configurable
    if (attendance.workSummary.effectiveHours >= minWorkHours) {
      attendance.status = ATTENDANCE_STATUS.PRESENT;
    } else {
      attendance.status = ATTENDANCE_STATUS.PARTIAL;
    }

    // Check if user is leaving early (office hours: 9:00 AM to 5:30 PM IST)
    const now = getCurrentISTTime();
    const standardEndTime = getISTStartOfDay();
    standardEndTime.setHours(17, 30, 0, 0); // 5:30 PM IST

    if (now < standardEndTime) {
      activeSession.checkOut.isEarly = true;
      activeSession.checkOut.earlyMinutes = Math.round((standardEndTime - now) / (1000 * 60));
    }

    // Update the attendance record
    attendance.sessions[activeSessionIndex] = activeSession;

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
    const today = getTodayIST();

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
    const today = getTodayIST();

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
    const today = getTodayIST();

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

// @route   GET /api/attendance/records
// @desc    Get attendance records with pagination and filtering
// @access  Private
router.get('/records', auth, async (req, res) => {
  try {
    // Get parameters from headers
    const page = parseInt(req.headers['page']) || 1;
    const limit = parseInt(req.headers['limit']) || 10;
    const startDate = req.headers['start-date'];
    const endDate = req.headers['end-date'];
    const userId = req.headers['user-id']; // Single user ID

    // Validate pagination
    if (page < 1) {
      return res.status(400).json({
        success: false,
        message: 'Page must be a positive integer'
      });
    }

    if (limit < 1 || limit > 100) {
      return res.status(400).json({
        success: false,
        message: 'Limit must be between 1 and 100'
      });
    }

    // Build filter
    const filter = {};

    // Use IST date parser
    const parseDate = parseDateDDMMYYYY;

    // Date filtering
    if (startDate || endDate) {
      filter.date = {};

      let start = null;
      let end = null;

      if (startDate) {
        start = parseDate(startDate);
        if (!start || isNaN(start.getTime())) {
          return res.status(400).json({
            success: false,
            message: 'Invalid start date format. Use DD/MM/YYYY or ISO8601 format'
          });
        }
        start.setHours(0, 0, 0, 0); // Start of day
      }

      if (endDate) {
        end = parseDate(endDate);
        if (!end || isNaN(end.getTime())) {
          return res.status(400).json({
            success: false,
            message: 'Invalid end date format. Use DD/MM/YYYY or ISO8601 format'
          });
        }
        end.setHours(23, 59, 59, 999); // End of day
      }

      // Validate: end date cannot be in the future
      const today = getISTEndOfDay();

      if (end && end > today) {
        return res.status(400).json({
          success: false,
          message: 'End date cannot be in the future'
        });
      }

      // Validate: end date cannot be before start date
      if (start && end && end < start) {
        return res.status(400).json({
          success: false,
          message: 'End date cannot be before start date'
        });
      }

      // Apply filters
      if (start) {
        filter.date.$gte = start;
      }
      if (end) {
        filter.date.$lte = end;
      }
    }

    // User filtering based on role and userId header
    if (userId) {
      // Specific user requested
      if (req.user.role === USER_ROLES.ADMIN) {
        // Admin can see any user
        filter.userId = userId;
      } else if (req.user.role === USER_ROLES.MANAGER) {
        // Manager can only see users from their team
        const teamMember = await User.findOne({
          _id: userId,
          office: req.user.office,
          department: req.user.department,
          isActive: true
        }).select('_id');

        if (!teamMember) {
          return res.status(403).json({
            success: false,
            message: 'You can only view attendance for your team members'
          });
        }

        filter.userId = userId;
      } else {
        // Regular employees can only see their own attendance
        if (userId !== req.user._id.toString()) {
          return res.status(403).json({
            success: false,
            message: 'You can only view your own attendance'
          });
        }
        filter.userId = req.user._id;
      }
    } else {
      // No specific user - get all accessible users
      if (req.user.role === USER_ROLES.ADMIN) {
        // Admin can see all users - no filter needed
      } else if (req.user.role === USER_ROLES.MANAGER) {
        // Manager can see their team
        const teamMembers = await User.find({
          office: req.user.office,
          department: req.user.department,
          isActive: true
        }).select('_id');

        filter.userId = { $in: teamMembers.map(user => user._id) };
      } else {
        // Regular employees can only see their own
        filter.userId = req.user._id;
      }
    }

    // Pagination
    const skip = (page - 1) * limit;

    // Execute query with pagination
    const total = await Attendance.countDocuments(filter);

    const attendanceRecords = await Attendance.find(filter)
      .sort({ date: -1 })
      .skip(skip)
      .limit(limit)
      .populate('userId', 'firstName lastName email role office department');

    // Process records to include session information
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

    // Fill in missing dates with "absent" status (excluding Sundays)
    let completeRecords = [...processedRecords];

    if (startDate && endDate) {
      const start = parseDate(startDate);
      const end = parseDate(endDate);

      if (start && end) {
        // Generate all dates in range
        const allDates = [];
        const currentDate = new Date(start);

        while (currentDate <= end) {
          const dateStr = currentDate.toISOString().split('T')[0];
          const dayOfWeek = currentDate.getDay(); // 0 = Sunday, 1 = Monday, etc.

          // Skip Sundays (0)
          if (dayOfWeek !== 0) {
            allDates.push({
              dateStr,
              date: new Date(currentDate)
            });
          }

          currentDate.setDate(currentDate.getDate() + 1);
        }

        // Create a map of existing records by date
        const recordMap = new Map();
        processedRecords.forEach(record => {
          const recordDateStr = new Date(record.date).toISOString().split('T')[0];
          recordMap.set(recordDateStr, record);
        });

        // Build complete records array with absent entries for missing dates
        completeRecords = allDates.map(({ dateStr, date }) => {
          if (recordMap.has(dateStr)) {
            return recordMap.get(dateStr);
          } else {
            // Create absent entry
            return {
              date: date,
              userId: userId ? { _id: userId } : null,
              status: 'absent',
              workLocation: null,
              sessions: [],
              breaks: [],
              workSummary: {
                totalHours: 0,
                totalBreakTime: 0,
                effectiveHours: 0,
                overtime: 0,
                undertime: 0
              },
              sessionSummary: {
                totalSessions: 0,
                completedSessions: 0,
                activeSessions: 0,
                firstCheckIn: null,
                lastCheckOut: null
              },
              isAbsent: true
            };
          }
        }).sort((a, b) => new Date(a.date) - new Date(b.date)); // Sort ascending by date
      }
    }

    // Calculate pagination info
    const totalPages = Math.ceil(total / limit);

    // Calculate summary statistics (including absent days)
    const absentDays = completeRecords.filter(r => r.status === 'absent' || r.isAbsent).length;
    const summary = {
      totalRecords: completeRecords.length,
      presentDays: attendanceRecords.filter(r => r.status === ATTENDANCE_STATUS.PRESENT).length,
      partialDays: attendanceRecords.filter(r => r.status === ATTENDANCE_STATUS.PARTIAL).length,
      absentDays: absentDays,
      workFromHomeDays: attendanceRecords.filter(r => r.workLocation === WORK_LOCATION.HOME).length,
      workFromOfficeDays: attendanceRecords.filter(r => r.workLocation === WORK_LOCATION.OFFICE).length,
      totalWorkHours: attendanceRecords.reduce((sum, r) => sum + (r.workSummary?.totalHours || 0), 0),
      totalEffectiveHours: attendanceRecords.reduce((sum, r) => sum + (r.workSummary?.effectiveHours || 0), 0),
      totalOvertime: attendanceRecords.reduce((sum, r) => sum + (r.workSummary?.overtime || 0), 0),
      totalSessions: attendanceRecords.reduce((sum, r) => sum + (r.sessions?.length || 0), 0)
    };

    res.json({
      success: true,
      data: {
        attendanceRecords: completeRecords,
        summary,
        pagination: {
          currentPage: page,
          totalPages,
          totalRecords: total,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
          limit
        }
      }
    });
  } catch (error) {
    console.error('Get attendance records error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching attendance records'
    });
  }
});

// @route   GET /api/attendance/export-excel
// @desc    Export attendance records to Excel
// @access  Private
router.get('/export-excel', auth, async (req, res) => {
  try {
    // Get parameters from headers
    const startDate = req.headers['start-date'];
    const endDate = req.headers['end-date'];
    const userId = req.headers['user-id'];

    // Validate required parameters
    if (!startDate || !endDate || !userId) {
      return res.status(400).json({
        success: false,
        message: 'start-date, end-date, and user-id are required in headers'
      });
    }

    // Use IST date parser
    const parseDate = parseDateDDMMYYYY;

    // Parse dates
    const start = parseDate(startDate);
    const end = parseDate(endDate);

    if (!start || isNaN(start.getTime())) {
      return res.status(400).json({
        success: false,
        message: 'Invalid start date format. Use DD/MM/YYYY or ISO8601 format'
      });
    }

    if (!end || isNaN(end.getTime())) {
      return res.status(400).json({
        success: false,
        message: 'Invalid end date format. Use DD/MM/YYYY or ISO8601 format'
      });
    }

    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);

    // Validate date range
    if (end < start) {
      return res.status(400).json({
        success: false,
        message: 'End date cannot be before start date'
      });
    }

    // Check authorization - Admin can see all, Manager can see team, Employee can see own
    if (req.user.role === USER_ROLES.EMPLOYEE && userId !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'You can only export your own attendance'
      });
    }

    if (req.user.role === USER_ROLES.MANAGER) {
      const teamMember = await User.findOne({
        _id: userId,
        office: req.user.office,
        department: req.user.department,
        isActive: true
      }).select('_id');

      if (!teamMember) {
        return res.status(403).json({
          success: false,
          message: 'You can only export attendance for your team members'
        });
      }
    }

    // Get user details
    const user = await User.findById(userId).select('firstName lastName email role office department');
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Fetch attendance records
    const attendanceRecords = await Attendance.find({
      userId: userId,
      date: {
        $gte: start,
        $lte: end
      }
    }).sort({ date: 1 });

    // Generate all dates in range (excluding Sundays)
    const allDates = [];
    const currentDate = new Date(start);

    while (currentDate <= end) {
      const dayOfWeek = currentDate.getDay(); // 0 = Sunday

      // Skip Sundays
      if (dayOfWeek !== 0) {
        allDates.push(new Date(currentDate));
      }

      currentDate.setDate(currentDate.getDate() + 1);
    }

    // Create a map of existing records by date
    const recordMap = new Map();
    attendanceRecords.forEach(record => {
      const recordDateStr = new Date(record.date).toISOString().split('T')[0];
      recordMap.set(recordDateStr, record);
    });

    // Build complete data array with absent entries
    const completeData = [];
    let totalLateMinutes = 0;
    let totalEarlyMinutes = 0;
    let totalOfficeDays = 0;
    let totalWFHDays = 0;
    let totalPresentDays = 0;
    let totalAbsentDays = 0;

    allDates.forEach(date => {
      const dateStr = date.toISOString().split('T')[0];
      const record = recordMap.get(dateStr);

      if (record) {
        let checkInTime = null;
        let checkOutTime = null;
        let lateMinutes = 0;
        let earlyMinutes = 0;

        if (record.sessions && record.sessions.length > 0) {
          // First session check-in
          const firstSession = record.sessions[0];
          if (firstSession.checkIn && firstSession.checkIn.time) {
            checkInTime = new Date(firstSession.checkIn.time);
            lateMinutes = firstSession.checkIn.lateMinutes || 0;
          }

          // Last session check-out
          const lastSession = record.sessions[record.sessions.length - 1];
          if (lastSession.checkOut && lastSession.checkOut.time) {
            checkOutTime = new Date(lastSession.checkOut.time);
            earlyMinutes = lastSession.checkOut.earlyMinutes || 0;
          }
        }

        totalLateMinutes += lateMinutes;
        totalEarlyMinutes += earlyMinutes;

        if (record.workLocation === WORK_LOCATION.HOME) totalWFHDays++;
        else if (record.workLocation === WORK_LOCATION.OFFICE) totalOfficeDays++;

        if (record.status === ATTENDANCE_STATUS.PRESENT || record.status === ATTENDANCE_STATUS.PARTIAL) {
          totalPresentDays++;
        }

        completeData.push({
          date: date,
          checkIn: checkInTime,
          checkOut: checkOutTime,
          lateMinutes: lateMinutes,
          earlyMinutes: earlyMinutes,
          status: record.status || 'present',
          workLocation: record.workLocation || 'office',
          totalHours: record.workSummary?.totalHours || 0,
          effectiveHours: record.workSummary?.effectiveHours || 0
        });
      } else {
        totalAbsentDays++;
        completeData.push({
          date: date,
          checkIn: null,
          checkOut: null,
          lateMinutes: 0,
          earlyMinutes: 0,
          status: 'absent',
          workLocation: null,
          totalHours: 0,
          effectiveHours: 0
        });
      }
    });

    // IST Conversion Functions
    const formatDateIST = (date) => {
      if (!date) return '-';
      return date.toLocaleDateString('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      });
    };

    const formatTimeIST = (date) => {
      if (!date) return '-';
      return date.toLocaleTimeString('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
    };

    // Create Excel workbook
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Attendance Report');

    // Set column widths
    worksheet.columns = [
      { key: 'date', width: 15 },
      { key: 'checkIn', width: 20 },
      { key: 'checkOut', width: 20 },
      { key: 'totalHours', width: 15 },
      { key: 'lateMinutes', width: 15 },
      { key: 'earlyMinutes', width: 15 },
      { key: 'status', width: 12 },
      { key: 'workLocation', width: 15 }
    ];

    // Add title row
    worksheet.mergeCells('A1:H1');
    const titleRow = worksheet.getCell('A1');
    titleRow.value = 'ATTENDANCE REPORT';
    titleRow.font = { size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
    titleRow.alignment = { horizontal: 'center', vertical: 'middle' };
    titleRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4472C4' }
    };
    worksheet.getRow(1).height = 30;

    // Add employee info
    worksheet.mergeCells('A2:B2');
    worksheet.getCell('A2').value = 'Employee Name:';
    worksheet.getCell('A2').font = { bold: true };
    worksheet.mergeCells('C2:H2');
    worksheet.getCell('C2').value = `${user.firstName} ${user.lastName}`;

    worksheet.mergeCells('A3:B3');
    worksheet.getCell('A3').value = 'Period:';
    worksheet.getCell('A3').font = { bold: true };
    worksheet.mergeCells('C3:H3');
    worksheet.getCell('C3').value = `${startDate} to ${endDate}`;

    // Add header row
    const headerRow = worksheet.getRow(5);
    headerRow.values = [
      'Date',
      'Check In (IST)',
      'Check Out (IST)',
      'Total Hours',
      'Late (min)',
      'Early (min)',
      'Status',
      'Location'
    ];
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF70AD47' }
    };
    headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
    headerRow.height = 25;

    // Add data rows
    let rowIndex = 6;
    completeData.forEach(data => {
      const row = worksheet.getRow(rowIndex);

      row.values = [
        formatDateIST(data.date),
        formatTimeIST(data.checkIn),
        formatTimeIST(data.checkOut),
        data.totalHours > 0 ? data.totalHours.toFixed(2) : '-',
        data.lateMinutes > 0 ? data.lateMinutes : '-',
        data.earlyMinutes > 0 ? data.earlyMinutes : '-',
        data.status.toUpperCase(),
        data.workLocation ? data.workLocation.toUpperCase() : 'ABSENT'
      ];

      // Color coding
      if (data.status === 'absent') {
        row.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFFCCCC' }
        };
      } else if (data.workLocation === WORK_LOCATION.HOME) {
        row.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFFE599' }
        };
      }

      row.alignment = { horizontal: 'center', vertical: 'middle' };
      rowIndex++;
    });

    // Add summary section
    rowIndex += 1;
    worksheet.mergeCells(`A${rowIndex}:H${rowIndex}`);
    const summaryTitleCell = worksheet.getCell(`A${rowIndex}`);
    summaryTitleCell.value = 'SUMMARY';
    summaryTitleCell.font = { size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
    summaryTitleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    summaryTitleCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4472C4' }
    };
    worksheet.getRow(rowIndex).height = 25;
    rowIndex++;

    const summaryData = [
      ['Total Working Days:', allDates.length],
      ['Total Present Days:', totalPresentDays],
      ['Total Absent Days:', totalAbsentDays],
      ['Total Office Days:', totalOfficeDays],
      ['Total Work From Home Days:', totalWFHDays],
      ['Total Late Minutes:', totalLateMinutes],
      ['Total Early Minutes:', totalEarlyMinutes]
    ];

    summaryData.forEach(([label, value]) => {
      worksheet.mergeCells(`A${rowIndex}:D${rowIndex}`);
      const labelCell = worksheet.getCell(`A${rowIndex}`);
      labelCell.value = label;
      labelCell.font = { bold: true };
      labelCell.alignment = { horizontal: 'left', vertical: 'middle' };

      worksheet.mergeCells(`E${rowIndex}:H${rowIndex}`);
      const valueCell = worksheet.getCell(`E${rowIndex}`);
      valueCell.value = value;
      valueCell.alignment = { horizontal: 'center', vertical: 'middle' };
      valueCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE7E6E6' }
      };

      rowIndex++;
    });

    // Add borders
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber >= 5) {
        row.eachCell((cell) => {
          cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' }
          };
        });
      }
    });

    // Generate filename
    const fileName = `Attendance_${user.firstName}_${user.lastName}_${startDate.replace(/\//g, '-')}_to_${endDate.replace(/\//g, '-')}.xlsx`;

    // Send response
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

    await workbook.xlsx.write(res);
    res.end();

  } catch (error) {
    console.error('Export Excel error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while exporting attendance records'
    });
  }
});

router.get('/history-details', auth, async (req, res) => {
  try {
    // 1️⃣ Get all users except admins
    const users = await User.find({ role: { $ne: 'admin' } })
      .select('_id firstName lastName role isLocked');

    if (!users || users.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No users found (excluding admins)'
      });
    }

    // 2️⃣ Define today's start and end (IST-based)
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000; // 5h 30m in ms
    const istNow = new Date(now.getTime() + istOffset);

    const istStart = new Date(istNow);
    istStart.setHours(0, 0, 0, 0);
    const istEnd = new Date(istNow);
    istEnd.setHours(23, 59, 59, 999);

    const startOfDay = new Date(istStart.getTime() - istOffset);
    const endOfDay = new Date(istEnd.getTime() - istOffset);

    // 3️⃣ Fetch today's attendance
    const todayRecords = await Attendance.find({
      createdAt: { $gte: startOfDay, $lte: endOfDay }
    }).lean();

    // 4️⃣ Create a map for quick lookup
    const attendanceMap = new Map();
    todayRecords.forEach(record => {
      attendanceMap.set(record.userId.toString(), record);
    });

    // 5️⃣ Build final response array
    const userStatusList = users.map(user => {
      const userId = user._id.toString();
      const attendance = attendanceMap.get(userId);

      let status = 'absent';
      let lateMinute;
      let checkInAt;

      if (attendance) {
        status = 'present';

        // Get lateMinutes and check-in time from first session if available
        if (attendance.sessions && attendance.sessions.length > 0) {
          const firstSession = attendance.sessions[0];
          if (firstSession?.checkIn?.lateMinutes !== undefined) {
            lateMinute = firstSession.checkIn.lateMinutes;
          }
          if (firstSession?.checkIn?.time !== undefined) {
            checkInAt = firstSession.checkIn.time;
          }
        }
      }

      return {
        _id: user._id,
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        fullName: `${user.firstName} ${user.lastName}`,
        role: user.role,
        isLocked: user.isLocked || false,
        status,
        ...(status === 'present' && lateMinute !== undefined ? { lateMinute } : {}),
        ...(status === 'present' && checkInAt !== undefined ? { checkInAt } : {}),
      };
    });

    // 6️⃣ Sort: all present first, then absent
    userStatusList.sort((a, b) => {
      if (a.status === b.status) return 0;
      return a.status === 'present' ? -1 : 1;
    });

    // 7️⃣ Send response
    return res.status(200).json({
      success: true,
      date: new Date().toISOString().split('T')[0],
      data: userStatusList
    });

  } catch (error) {
    console.error('Error fetching history details:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

module.exports = router;