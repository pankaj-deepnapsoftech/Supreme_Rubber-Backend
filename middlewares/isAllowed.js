const { TryCatch, ErrorHandler } = require('../utils/error');

exports.isAllowed = TryCatch(async (req, res, next) => {
    const route = req.originalUrl.split('/')[2];  // Get the route name from URL

    const user = req.user;
    if (!user) {
        throw new ErrorHandler('User not found', 401);
    }

    // If the user is a superuser, allow access
    if (user) {
        return next(); // Allow to proceed to next middleware/route handler
    }

    // If the user is not a superuser, check permissions
    const permissions = user.role?.permissions;

    if (!permissions || permissions.length === 0 || !permissions.includes(route)) {
        throw new ErrorHandler('You are not allowed to access this route', 401);  // Block if no permission
    }

    // If everything is okay, proceed to next middleware or route handler
    next();
});
