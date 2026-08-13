const Activity = require('../models/Activity');

exports.getRecentActivities = async (req, res) => {
    try {
        const activities = await Activity.getRecentActivities();
        res.json(activities);
    } catch (err) {
        console.error('Error fetching recent activities:', err.message);
        res.status(500).json({ error: 'Failed to fetch recent activities' });
    }
};
