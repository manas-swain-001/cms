const express = require('express');
const mongoose = require('mongoose');
const { body, validationResult, query } = require('express-validator');
const Task = require('../models/Task');
const { User } = require('../models/User');
const { auth, authorize, managerAccess, auditLog } = require('../middleware/auth');
const { USER_ROLES } = require('../constant/enum');
const {
  getTodayIST,
  getCurrentISTHourMinute
} = require('../utils/dateUtils');

const router = express.Router();

function parseISTDateRange(startDateStr, endDateStr) {
  const [sd, sm, sy] = startDateStr ? startDateStr.split('/') : [];
  const [ed, em, ey] = endDateStr ? endDateStr.split('/') : [];

  let start, end;

  if (sd && sm && sy) {
    // Interpret start as IST midnight, convert to UTC
    const startIST = new Date(`${sy}-${sm}-${sd}T00:00:00+05:30`);
    start = new Date(startIST.toISOString());
  }

  if (ed && em && ey) {
    // Interpret end as IST 23:59:59, convert to UTC
    const endIST = new Date(`${ey}-${em}-${ed}T23:59:59+05:30`);
    end = new Date(endIST.toISOString());
  }

  return { start, end };
}

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
    const today = getTodayIST();

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
    const { hour: currentHour, minute: currentMinute } = getCurrentISTHourMinute();
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
    // 05:00 PM to 05:30 PM (17:00 to 17:30) → update 05:30 PM (17:30) slot (office ends at 5:30 PM)
    else if (currentTotalMinutes >= 17 * 60 && currentTotalMinutes <= 17 * 60 + 30) { // 17:00 to 17:30
      targetScheduledTime = '17:30';
      isValidTimeWindow = true;
    }

    // Check if current time is within any allowed window
    if (!isValidTimeWindow) {
      return res.status(400).json({
        success: false,
        message: 'Updates can only be submitted during specific time windows: Before 11:00 AM, 11:30 AM-12:30 PM, 1:00 PM-2:00 PM, 3:30 PM-4:30 PM, or 5:00 PM-5:30 PM (Office hours: 9:00 AM - 5:30 PM IST)',
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
// @desc    Get task history for a specific user (Admin only)
// @access  Private (Admin only)
// @headers user-id, page, limit, start-date (dd/mm/yyyy), end-date (dd/mm/yyyy)
router.get('/history', [
  auth,
  authorize(USER_ROLES.ADMIN)
], async (req, res) => {
  try {
    // ---- 1. Extract headers ----
    const userId = req.headers['user-id'];
    const page = req.headers['page'] || '1';
    const limit = req.headers['limit'] || '10';
    const startDate = req.headers['start-date']; // dd/mm/yyyy
    const endDate = req.headers['end-date']; // dd/mm/yyyy

    // ---- 2. Validate userId ----
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'user-id header is required'
      });
    }

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user-id format'
      });
    }

    // ---- 3. Validate pagination ----
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);

    if (isNaN(pageNum) || pageNum < 1) {
      return res.status(400).json({
        success: false,
        message: 'page must be a positive integer'
      });
    }

    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
      return res.status(400).json({
        success: false,
        message: 'limit must be between 1 and 100'
      });
    }

    // ---- 4. Verify user exists ----
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // ---- 5. Build date filter (IST input → UTC conversion) ----
    let dateFilter = {};
    if (startDate || endDate) {
      const { start, end } = parseISTDateRange(startDate, endDate);
      if (start) dateFilter.$gte = start;
      if (end) dateFilter.$lte = end;
    }

    // Debug log (optional)
    console.log('📅 Final UTC Date Filter:', JSON.stringify(dateFilter, null, 2));

    // ---- 6. Pagination ----
    const skip = (pageNum - 1) * limitNum;

    // ---- 7. Query Mongo ----
    const query = {
      userId: userId,
      ...(Object.keys(dateFilter).length > 0 && { date: dateFilter })
    };

    const tasks = await Task.find(query)
      .sort({ date: -1 })
      .skip(skip)
      .limit(limitNum)
      .select('-__v')
      .lean();

    const total = await Task.countDocuments(query);
    const totalPages = Math.ceil(total / limitNum);

    // ---- 8. Format tasks ----
    const formattedTasks = tasks.map(task => ({
      _id: task._id,
      date: task.date.toISOString().split('T')[0], // keep YYYY-MM-DD
      scheduledEntries: (task.scheduledEntries || []).map(entry => ({
        _id: entry._id,
        scheduledTime: entry.scheduledTime,
        status: entry.status,
        description: entry.description,
        submittedAt: entry.submittedAt,
        createdAt: entry.createdAt
      })),
      createdAt: task.createdAt,
      updatedAt: task.updatedAt
    }));

    // ---- 9. Response ----
    res.json({
      success: true,
      message: `Retrieved ${tasks.length} task record(s) for ${user.firstName} ${user.lastName}`,
      data: {
        user: {
          id: user._id,
          name: `${user.firstName} ${user.lastName}`,
          employeeId: user.employeeId,
          email: user.email
        },
        tasks: formattedTasks,
        pagination: {
          currentPage: pageNum,
          totalPages,
          totalRecords: total,
          hasNextPage: pageNum < totalPages,
          hasPrevPage: pageNum > 1,
          limit: limitNum
        }
      }
    });

  } catch (error) {
    console.error('❌ Get task history error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching task history'
    });
  }
});

module.exports = router;