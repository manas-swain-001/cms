const express = require('express');
const { body, validationResult, query } = require('express-validator');
const Task = require('../models/Task');
const { User } = require('../models/User');
const { auth, authorize, managerAccess, auditLog } = require('../middleware/auth');
const { USER_ROLES } = require('../constant/enum');

const router = express.Router();

// @route   GET /api/tasks/today
// @desc    Get today's task for the current user
// @access  Private
router.get('/today', auth, async (req, res) => {
  try {
    const userId = req.user._id;
    
    // Get or create today's task
    const task = await Task.createOrGetTodayTask(userId);
    
    // Populate user details
    const user = await User.findById(userId).select('firstName lastName email employeeId office');
    
    res.json({
      success: true,
      data: { 
        task,
        user: {
          _id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          employeeId: user.employeeId,
          office: user.office
        }
      }
    });
  } catch (error) {
    console.error('Get today tasks error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching today\'s tasks'
    });
  }
});

// @route   GET /api/tasks/completed-updates
// @desc    Get only completed, warned, or escalated updates for today (excludes pending)
// @access  Private
router.get('/completed-updates', auth, async (req, res) => {
  try {
    const userId = req.user._id;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Find today's task
    const task = await Task.findOne({
      userId: userId,
      date: today
    });

    // If no task found, return empty array
    if (!task) {
      return res.json({
        success: true,
        message: 'No tasks found for today',
        data: {
          updates: [],
          total: 0
        }
      });
    }

    // Filter only non-pending entries (submitted, warning_sent, escalated)
    const completedUpdates = task.scheduledEntries.filter(entry => 
      entry.status === 'submitted' || 
      entry.status === 'warning_sent' || 
      entry.status === 'escalated'
    );

    // If all are pending, return empty array
    if (completedUpdates.length === 0) {
      return res.json({
        success: true,
        message: 'No completed, warned, or escalated updates yet',
        data: {
          updates: [],
          total: 0
        }
      });
    }

    // Return only the filtered entries
    res.json({
      success: true,
      message: `Found ${completedUpdates.length} update(s)`,
      data: {
        updates: completedUpdates.map(entry => ({
          scheduledTime: entry.scheduledTime,
          status: entry.status,
          description: entry.description,
          submittedAt: entry.submittedAt,
          createdAt: entry.createdAt
        })),
        total: completedUpdates.length,
        taskId: task._id,
        date: task.date
      }
    });
  } catch (error) {
    console.error('Get completed updates error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching completed updates'
    });
  }
});

// @route   POST /api/tasks/submit-update
// @desc    Submit an update for the current time slot (auto-determines which entry to update)
// @access  Private
router.post('/submit-update', [
  auth,
  body('description')
    .trim()
    .isLength({ min: 1, max: 500 })
    .withMessage('Description is required and must be between 1 and 500 characters'),
  auditLog('SUBMIT_TASK_UPDATE')
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
    const { description } = req.body;

    // Get today's task
    const task = await Task.getTodayTask(userId);
    
    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'No task found for today. Please punch in first.'
      });
    }

    // Auto-determine which scheduled entry to update based on current time
    const currentTime = new Date();
    const currentHour = currentTime.getHours();
    const currentMinute = currentTime.getMinutes();
    const currentTimeString = `${currentHour.toString().padStart(2, '0')}:${currentMinute.toString().padStart(2, '0')}`;
    
    // Calculate total minutes from midnight for easier comparison
    const currentTotalMinutes = currentHour * 60 + currentMinute;
    
    // Define allowed time windows and their target slots
    let targetScheduledTime = null;
    let isValidTimeWindow = false;
    
    // Before 10:30 to 11:00 → update 10:30 slot
    if (currentTotalMinutes < 11 * 60) { // Before 11:00 AM
      targetScheduledTime = '10:30';
      isValidTimeWindow = true;
    }
    // 11:30 to 12:30 → update 12:00 slot
    else if (currentTotalMinutes >= 11 * 60 + 30 && currentTotalMinutes <= 12 * 60 + 30) { // 11:30 to 12:30
      targetScheduledTime = '12:00';
      isValidTimeWindow = true;
    }
    // 01:00 PM to 02:00 PM (13:00 to 14:00) → update 01:30 PM (13:30) slot
    else if (currentTotalMinutes >= 13 * 60 && currentTotalMinutes <= 14 * 60) { // 13:00 to 14:00
      targetScheduledTime = '13:30';
      isValidTimeWindow = true;
    }
    // 03:30 PM to 04:30 PM (15:30 to 16:30) → update 04:00 PM (16:00) slot
    else if (currentTotalMinutes >= 15 * 60 + 30 && currentTotalMinutes <= 16 * 60 + 30) { // 15:30 to 16:30
      targetScheduledTime = '16:00';
      isValidTimeWindow = true;
    }
    // 05:00 PM to 06:00 PM (17:00 to 18:00) → update 05:30 PM (17:30) slot
    else if (currentTotalMinutes >= 17 * 60 && currentTotalMinutes <= 18 * 60) { // 17:00 to 18:00
      targetScheduledTime = '17:30';
      isValidTimeWindow = true;
    }
    
    // Check if current time is within any allowed window
    if (!isValidTimeWindow) {
      return res.status(400).json({
        success: false,
        message: 'Updates can only be submitted during specific time windows: Before 11:00 AM, 11:30 AM-12:30 PM, 1:00 PM-2:00 PM, 3:30 PM-4:30 PM, or 5:00 PM-6:00 PM',
        currentTime: currentTimeString
      });
    }

    // Find the target entry
    const targetEntry = task.scheduledEntries.find(entry => entry.scheduledTime === targetScheduledTime);
    
    if (!targetEntry) {
      return res.status(404).json({
      success: false,
        message: `No scheduled entry found for ${targetScheduledTime}. Please check your punch-in time.`
      });
    }

    // Check if entry is already escalated
    if (targetEntry.status === 'escalated') {
      return res.status(400).json({
        success: false,
        message: `Entry for ${targetScheduledTime} has already been escalated. Please wait for the next scheduled time.`
      });
    }

    // Check if entry is already submitted
    if (targetEntry.status === 'submitted') {
      return res.status(400).json({
        success: false,
        message: `Entry for ${targetScheduledTime} has already been submitted.`
      });
    }

    // Submit the update
    targetEntry.status = 'submitted';
    targetEntry.description = description.trim();
    targetEntry.submittedAt = new Date();

    await task.save();

    res.json({
      success: true,
      message: `Update submitted successfully for ${targetScheduledTime}`,
      data: { 
        task,
        submittedEntry: {
          scheduledTime: targetScheduledTime,
          description: description.trim(),
          submittedAt: new Date(),
          currentTime: currentTimeString
        }
      }
    });
  } catch (error) {
    console.error('Submit update error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while submitting update'
    });
  }
});

// @route   GET /api/tasks/history
// @desc    Get task history for the current user
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
      endDate
    } = req.query;

    const userId = req.user._id;
    
    // Build date filter
    let dateFilter = {};
    if (startDate || endDate) {
      dateFilter = {
        $gte: startDate ? new Date(startDate) : undefined,
        $lte: endDate ? new Date(endDate) : undefined
      };
      // Remove undefined values
      Object.keys(dateFilter).forEach(key => dateFilter[key] === undefined && delete dateFilter[key]);
    }

    // Get tasks with pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const tasks = await Task.find({
      userId,
      ...(Object.keys(dateFilter).length > 0 && { date: dateFilter })
    })
    .sort({ date: -1 })
    .skip(skip)
    .limit(parseInt(limit));

    const total = await Task.countDocuments({
      userId,
      ...(Object.keys(dateFilter).length > 0 && { date: dateFilter })
    });

    // Calculate pagination info
    const totalPages = Math.ceil(total / parseInt(limit));

    res.json({
      success: true,
      data: {
        tasks,
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
    console.error('Get task history error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching task history'
    });
  }
});

// @route   GET /api/tasks/user/:userId
// @desc    Get tasks for a specific user (for managers)
// @access  Private (Manager/Admin)
router.get('/user/:userId', [
  auth,
  authorize(USER_ROLES.ADMIN, USER_ROLES.MANAGER),
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

    const { userId } = req.params;
    const { startDate, endDate } = req.query;

    // Check if user exists
    const user = await User.findById(userId).select('firstName lastName email employeeId office department');
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check permissions for managers
    if (req.user.role === USER_ROLES.MANAGER) {
      if (user.office !== req.user.office || 
          (req.user.department && user.department !== req.user.department)) {
        return res.status(403).json({
          success: false,
          message: 'You can only view tasks for your team members'
        });
      }
    }

    // Build date filter
    let dateFilter = {};
    if (startDate || endDate) {
      dateFilter = {
        $gte: startDate ? new Date(startDate) : undefined,
        $lte: endDate ? new Date(endDate) : undefined
      };
      Object.keys(dateFilter).forEach(key => dateFilter[key] === undefined && delete dateFilter[key]);
    }

    // Get user tasks
    const tasks = await Task.find({
      userId,
      ...(Object.keys(dateFilter).length > 0 && { date: dateFilter })
    }).sort({ date: -1 });

    res.json({
      success: true,
      data: {
        user: {
          _id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          employeeId: user.employeeId,
          office: user.office,
          department: user.department
        },
        tasks
      }
    });
  } catch (error) {
    console.error('Get user tasks error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching user tasks'
    });
  }
});

module.exports = router;