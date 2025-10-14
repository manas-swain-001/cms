const express = require('express');
const { body, validationResult, query } = require('express-validator');
const { Task, clearTaskStorage } = require('../models/Task');
const { User } = require('../models/User');
const { auth, authorize, managerAccess, auditLog } = require('../middleware/auth');
const { USER_ROLES } = require('../constant/enum');

const router = express.Router();

// @route   DELETE /api/tasks/clear
// @desc    Clear all task storage (for testing)
// @access  Private
router.delete('/clear', auth, async (req, res) => {
  try {
    clearTaskStorage();
    res.json({
      success: true,
      message: 'Task storage cleared successfully'
    });
  } catch (error) {
    console.error('Clear task storage error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while clearing task storage'
    });
  }
});

// @route   GET /api/tasks/today
// @desc    Get today's task compliance status
// @access  Private
router.get('/today', auth, async (req, res) => {
  try {
    const userId = req.user._id;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let task = await Task.findOne({
      userId,
      date: today
    });

    // Create task record if it doesn't exist
    if (!task) {
      console.log('Creating new task for user:', userId);
      task = await Task.create({
        userId,
        date: today,
        office: req.user.office
      });
      console.log('Created task:', JSON.stringify(task, null, 2));
    }
    
    // Populate user details
    if (task) {
      const user = await User.findById(task.userId);
      if (user) {
        task.userId = {
          _id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          role: user.role,
          office: user.office
        };
      }
    }

    res.json({
      success: true,
      data: { task }
    });
  } catch (error) {
    console.error('Get today tasks error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching today\'s tasks'
    });
  }
});

// @route   PUT /api/tasks/update-slot
// @desc    Update task slot status
// @access  Private
router.put('/update-slot', [
  auth,
  body('slot')
    .isIn(['morning', 'afternoon', 'evening'])
    .withMessage('Invalid slot. Must be morning, afternoon, or evening'),
  body('taskIndex')
    .isInt({ min: 0, max: 4 })
    .withMessage('Task index must be between 0 and 4'),
  body('status')
    .isIn(['pending', 'completed', 'skipped', 'in_progress'])
    .withMessage('Invalid status'),
  body('notes')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Notes must not exceed 500 characters'),
  auditLog('UPDATE_TASK_SLOT')
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
    const { slot, taskIndex, status, notes, completedAt } = req.body;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Find or create today's task record
    let task = await Task.findOne({ userId, date: today });
    
    if (!task) {
      task = await Task.create({
        userId,
        date: today,
        office: req.user.office
      });
    }

    // Update the specific task slot
    const slotData = task.slots[slot];
    if (!slotData || !slotData.tasks[taskIndex]) {
      return res.status(400).json({
        success: false,
        message: 'Invalid task index for the specified slot'
      });
    }

    // Update task status
    slotData.tasks[taskIndex].status = status;
    slotData.tasks[taskIndex].notes = notes || slotData.tasks[taskIndex].notes;
    
    if (status === 'completed') {
      slotData.tasks[taskIndex].completedAt = completedAt ? new Date(completedAt) : new Date();
    } else if (status === 'in_progress') {
      slotData.tasks[taskIndex].startedAt = new Date();
    }

    // Update slot completion status
    task.updateSlot(slot, { status: slotData.status });

    await task.save();

    res.json({
      success: true,
      message: 'Task slot updated successfully',
      data: { 
        task,
        updatedSlot: slot,
        updatedTask: slotData.tasks[taskIndex]
      }
    });
  } catch (error) {
    console.error('Update task slot error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while updating task slot'
    });
  }
});

// @route   POST /api/tasks/bulk-update
// @desc    Bulk update multiple task slots
// @access  Private
router.post('/bulk-update', [
  auth,
  body('updates')
    .isArray({ min: 1, max: 15 })
    .withMessage('Updates must be an array with 1-15 items'),
  body('updates.*.slot')
    .isIn(['morning', 'afternoon', 'evening'])
    .withMessage('Invalid slot'),
  body('updates.*.taskIndex')
    .isInt({ min: 0, max: 4 })
    .withMessage('Invalid task index'),
  body('updates.*.status')
    .isIn(['pending', 'completed', 'skipped', 'in_progress'])
    .withMessage('Invalid status'),
  auditLog('BULK_UPDATE_TASKS')
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
    const { updates } = req.body;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Find or create today's task record
    let task = await Task.findOne({ userId, date: today });
    
    if (!task) {
      task = await Task.create({
        userId,
        date: today,
        office: req.user.office
      });
    }

    // Apply all updates
    const updatedSlots = new Set();
    
    for (const update of updates) {
      const { slot, taskIndex, status, notes } = update;
      
      if (!task.slots[slot] || !task.slots[slot].tasks[taskIndex]) {
        continue; // Skip invalid task indices
      }

      // Update task
      task.slots[slot].tasks[taskIndex].status = status;
      if (notes) {
        task.slots[slot].tasks[taskIndex].notes = notes;
      }
      
      if (status === 'completed') {
        task.slots[slot].tasks[taskIndex].completedAt = new Date();
      } else if (status === 'in_progress') {
        task.slots[slot].tasks[taskIndex].startedAt = new Date();
      }
      
      updatedSlots.add(slot);
    }

    // Update completion status
    task.calculateCompliance();

    await task.save();

    res.json({
      success: true,
      message: `Successfully updated ${updates.length} task slots`,
      data: { 
        task,
        updatedSlots: Array.from(updatedSlots),
        updatesApplied: updates.length
      }
    });
  } catch (error) {
    console.error('Bulk update tasks error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while bulk updating tasks'
    });
  }
});

// @route   GET /api/tasks/history
// @desc    Get task compliance history
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
    
    // Build filter
    const filter = { userId };
    
    if (startDate || endDate) {
      filter.date = {};
      if (startDate) filter.date.$gte = new Date(startDate);
      if (endDate) filter.date.$lte = new Date(endDate);
    }

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Execute query
    let tasks = await Task.find(filter);
    
    // Apply sorting
    tasks = tasks.sort((a, b) => new Date(b.date) - new Date(a.date));
    
    // Get total count
    const total = tasks.length;
    
    // Apply pagination
    tasks = tasks.slice(skip, skip + parseInt(limit));
    
    // Populate user details
    tasks = tasks.map(task => {
      const user = User.findById(task.userId);
      if (user) {
        task.userId = {
          _id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email
        };
      }
      return task;
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

// @route   GET /api/tasks/team
// @desc    Get team task compliance (for managers)
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

    // Get task compliance for team members
    const teamIds = teamMembers.map(member => member._id);
    const taskRecords = Task.find({
      userId: teamIds,
      date: targetDate
    }).map(task => {
      const user = User.findById(task.userId);
      if (user) {
        task.userId = {
          _id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          role: user.role
        };
      }
      return task;
    });

    // Combine team members with their task compliance
    const teamTasks = teamMembers.map(member => {
      const task = taskRecords.find(
        record => record.userId._id.toString() === member._id.toString()
      );
      
      return {
        user: member,
        task: task || null,
        complianceScore: task ? task.complianceMetrics.overallScore : 0,
        completedTasks: task ? task.complianceMetrics.completedTasks : 0,
        totalTasks: task ? task.complianceMetrics.totalTasks : 15,
        status: task ? task.overallStatus : 'not_started'
      };
    });

    // Calculate team summary
    const summary = {
      totalTeamMembers: teamMembers.length,
      averageCompliance: teamTasks.reduce((sum, tt) => sum + tt.complianceScore, 0) / teamMembers.length,
      highPerformers: teamTasks.filter(tt => tt.complianceScore >= 80).length,
      needsAttention: teamTasks.filter(tt => tt.complianceScore < 50).length,
      totalTasksCompleted: teamTasks.reduce((sum, tt) => sum + tt.completedTasks, 0),
      totalTasksAssigned: teamTasks.reduce((sum, tt) => sum + tt.totalTasks, 0)
    };

    res.json({
      success: true,
      data: {
        date: targetDate,
        teamTasks,
        summary
      }
    });
  } catch (error) {
    console.error('Get team tasks error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching team task compliance'
    });
  }
});

// @route   GET /api/tasks/reports/compliance
// @desc    Get task compliance report
// @access  Private (Manager/Admin)
router.get('/reports/compliance', [
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

    // Get compliance summary
    const summary = Task.getComplianceSummary(filter);

    res.json({
      success: true,
      data: {
        period: { startDate, endDate },
        summary
      }
    });
  } catch (error) {
    console.error('Get compliance report error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while generating compliance report'
    });
  }
});

// @route   PUT /api/tasks/:id/review
// @desc    Review and approve task compliance
// @access  Private (Manager/Admin)
router.put('/:id/review', [
  auth,
  authorize(USER_ROLES.ADMIN, USER_ROLES.MANAGER),
  body('status')
    .isIn(['approved', 'rejected', 'needs_revision'])
    .withMessage('Invalid review status'),
  body('feedback')
    .optional()
    .trim()
    .isLength({ max: 1000 })
    .withMessage('Feedback must not exceed 1000 characters'),
  auditLog('REVIEW_TASK_COMPLIANCE')
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

    const taskId = req.params.id;
    const { status, feedback } = req.body;

    const task = Task.findById(taskId);
    
    if (task) {
      const user = User.findById(task.userId);
      if (user) {
        task.userId = {
          _id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          office: user.office,
          department: user.department
        };
      }
    }

    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task record not found'
      });
    }

    // Check if manager can review this task
    if (req.user.role === USER_ROLES.MANAGER) {
      if (task.userId.office !== req.user.office || 
          task.userId.department !== req.user.department) {
        return res.status(403).json({
          success: false,
          message: 'You can only review tasks for your team members'
        });
      }
    }

    // Update review status
    task.review = {
      status,
      reviewedBy: req.user._id,
      reviewedAt: new Date(),
      feedback
    };

    // Update approval status
    task.approval = {
      status: status === 'approved' ? 'approved' : 'pending',
      approvedBy: status === 'approved' ? req.user._id : undefined,
      approvedAt: status === 'approved' ? new Date() : undefined
    };

    Task.findByIdAndUpdate(taskId, task);

    res.json({
      success: true,
      message: 'Task compliance reviewed successfully',
      data: { task }
    });
  } catch (error) {
    console.error('Review task error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while reviewing task compliance'
    });
  }
});

// @route   GET /api/tasks/analytics/trends
// @desc    Get task compliance trends
// @access  Private (Manager/Admin)
router.get('/analytics/trends', [
  auth,
  authorize(USER_ROLES.ADMIN, USER_ROLES.MANAGER),
  query('period')
    .isIn(['week', 'month', 'quarter'])
    .withMessage('Period must be week, month, or quarter'),
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

    const { period = 'month', userId } = req.query;
    
    // Calculate date range based on period
    const endDate = new Date();
    const startDate = new Date();
    
    switch (period) {
      case 'week':
        startDate.setDate(endDate.getDate() - 7);
        break;
      case 'month':
        startDate.setMonth(endDate.getMonth() - 1);
        break;
      case 'quarter':
        startDate.setMonth(endDate.getMonth() - 3);
        break;
    }
    
    startDate.setHours(0, 0, 0, 0);
    endDate.setHours(23, 59, 59, 999);

    // Build filter
    const filter = {
      date: { $gte: startDate, $lte: endDate }
    };

    // Role-based filtering
    if (req.user.role === USER_ROLES.MANAGER) {
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

    // Get trend data
    const tasks = Task.find(filter);
    
    // Group by date and calculate metrics
    const groupedData = {};
    tasks.forEach(task => {
      const dateKey = task.date.toISOString().split('T')[0];
      if (!groupedData[dateKey]) {
        groupedData[dateKey] = {
          complianceScores: [],
          totalTasks: 0,
          completedTasks: 0,
          recordCount: 0
        };
      }
      
      groupedData[dateKey].complianceScores.push(task.complianceMetrics.overallScore);
      groupedData[dateKey].totalTasks += task.complianceMetrics.totalTasks;
      groupedData[dateKey].completedTasks += task.complianceMetrics.completedTasks;
      groupedData[dateKey].recordCount += 1;
    });
    
    // Convert to trends format and sort
    const trends = Object.keys(groupedData)
      .map(date => ({
        _id: { date },
        averageCompliance: groupedData[date].complianceScores.reduce((sum, score) => sum + score, 0) / groupedData[date].complianceScores.length,
        totalTasks: groupedData[date].totalTasks,
        completedTasks: groupedData[date].completedTasks,
        recordCount: groupedData[date].recordCount
      }))
      .sort((a, b) => a._id.date.localeCompare(b._id.date));

    res.json({
      success: true,
      data: {
        period,
        dateRange: { startDate, endDate },
        trends
      }
    });
  } catch (error) {
    console.error('Get task trends error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching task compliance trends'
    });
  }
});

module.exports = router;