const express = require('express');
const { body, validationResult, query } = require('express-validator');
const { Task } = require('../models/Task');
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
    
    // Determine which time slot the current time falls into
    let targetScheduledTime = null;
    
    if (currentHour < 10 || (currentHour === 10 && currentMinute < 30)) {
      // Before 10:30 - should update 10:30 slot
      targetScheduledTime = '10:30';
    } else if (currentHour < 12 || (currentHour === 12 && currentMinute === 0)) {
      // Between 10:30 and 12:00 - should update 10:30 slot
      targetScheduledTime = '10:30';
    } else if (currentHour < 13 || (currentHour === 13 && currentMinute < 30)) {
      // Between 12:00 and 13:30 - should update 12:00 slot
      targetScheduledTime = '12:00';
    } else if (currentHour < 16 || (currentHour === 16 && currentMinute === 0)) {
      // Between 13:30 and 16:00 - should update 13:30 slot
      targetScheduledTime = '13:30';
    } else if (currentHour < 17 || (currentHour === 17 && currentMinute < 30)) {
      // Between 16:00 and 17:30 - should update 16:00 slot
      targetScheduledTime = '16:00';
    } else {
      // After 17:30 - should update 17:30 slot
      targetScheduledTime = '17:30';
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