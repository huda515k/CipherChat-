const express = require('express');
const SecurityLog = require('../models/SecurityLog');
const { authenticateToken } = require('./auth');
const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

// Get security logs (admin or own logs)
router.get('/', async (req, res) => {
  try {
    const { eventType, severity, limit = 100, skip = 0 } = req.query;
    const userId = req.user.userId;

    const query = { userId };
    if (eventType) query.eventType = eventType;
    if (severity) query.severity = severity;

    const logs = await SecurityLog.find(query)
      .sort({ timestamp: -1 })
      .limit(parseInt(limit))
      .skip(parseInt(skip))
      .lean();

    res.json(logs);
  } catch (error) {
    console.error('Get logs error:', error);
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

// Get logs by event type
router.get('/event/:eventType', async (req, res) => {
  try {
    const { eventType } = req.params;
    const userId = req.user.userId;
    const { limit = 50 } = req.query;

    const logs = await SecurityLog.find({
      userId,
      eventType
    })
      .sort({ timestamp: -1 })
      .limit(parseInt(limit))
      .lean();

    res.json(logs);
  } catch (error) {
    console.error('Get logs by event type error:', error);
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

module.exports = router;

