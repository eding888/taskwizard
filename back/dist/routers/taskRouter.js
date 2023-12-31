import express from 'express';
import { countDays, getCurrentEpochInSeconds } from '../utils/dayOfWeekHelper.js';
import 'express-async-errors';
import Task from '../models/task.js';
import User from '../models/user.js';
const taskRouter = express.Router();
const checkIfTimeSurpassed = async (startTime, task) => {
    const time = getCurrentEpochInSeconds();
    if (startTime !== -1 && task.timeLeftToday !== 0 && (((time - startTime) / 1000) >= task.timeLeftToday)) {
        task.totalTimeToday += task.timeLeftToday;
        task.timeLeftToday = 0;
        await task.save();
        return true;
    }
    return false;
};
taskRouter.get('/current', async (request, response) => {
    if (!request.user) {
        return response.status(401).json({ error: 'User/token not found' });
    }
    const user = request.user;
    const tasks = [];
    for (const userTask of user.tasks) {
        const task = await Task.findById(userTask.id);
        if (!task) {
            return response.status(404).json({ error: 'Invalid task id' });
        }
        await checkIfTimeSurpassed(userTask.startTime, task);
        tasks.push(task);
    }
    response.status(200).json({ tasks });
});
taskRouter.get('/friend/:username', async (request, response) => {
    if (!request.user) {
        return response.status(401).json({ error: 'User/token not found' });
    }
    const username = request.params.username;
    const user = await User.findOne({ username: { $regex: new RegExp(username, 'i') } });
    if (!user) {
        return response.status(400).json({ error: 'User does not exist.' });
    }
    if (request.user.friendsData.friends.map(friend => friend.toUpperCase() === username.toUpperCase()).length === 0) {
        return response.status(401).json({ error: 'You do not have this user added.' });
    }
    const tasks = [];
    for (const userTask of user.tasks) {
        const task = await Task.findById(userTask.id);
        if (!task) {
            return response.status(404).json({ error: 'Invalid task id' });
        }
        await checkIfTimeSurpassed(userTask.startTime, task);
        tasks.push(task);
    }
    response.status(200).json({ tasks });
});
taskRouter.post('/newTask', async (request, response) => {
    const { type, name, discrete, daysOfWeek, deadlineDate, time } = request.body;
    if (type === null || type === undefined) {
        return response.status(400).json({ error: 'Missing task type' });
    }
    const taskType = type === 0 ? 'recurring' : 'deadline';
    if (name === null || name === undefined ||
        discrete === null || discrete === undefined ||
        (taskType === 'deadline' && (deadlineDate === null || deadlineDate === undefined)) ||
        time === null || time === undefined ||
        daysOfWeek === null || daysOfWeek === undefined) {
        return response.status(400).json({ error: 'Missing arguments' });
    }
    if (!request.user) {
        return response.status(401).json({ error: 'User/token not found' });
    }
    const date = new Date(deadlineDate);
    const deadlineOptions = taskType !== 'deadline'
        ? null
        : {
            deadline: {
                month: date.getMonth() + 1,
                day: date.getDate(),
                year: date.getFullYear()
            },
            timeRemaining: time
        };
    const recurringOptions = taskType !== 'recurring'
        ? null
        : {
            debt: 0,
            timePerWeek: time
        };
    const user = request.user;
    const task = new Task({
        type: taskType,
        name,
        deadlineOptions,
        recurringOptions,
        discrete,
        daysOfWeek
    });
    const today = new Date();
    if (deadlineOptions) {
        if (task.daysOfWeek.includes(today.getDay())) {
            const time = Math.round((deadlineOptions.timeRemaining / (countDays(task.daysOfWeek, task.deadlineOptions.deadline))));
            task.timeLeftToday = time;
            task.originalTimeToday = time;
        }
        else {
            task.timeLeftToday = 0;
            task.originalTimeToday = 0;
        }
    }
    else if (recurringOptions) {
        if (task.daysOfWeek.includes(today.getDay())) {
            const time = Math.round((recurringOptions.timePerWeek / task.daysOfWeek.length));
            task.timeLeftToday = time;
            task.originalTimeToday = time;
        }
        else {
            task.timeLeftToday = 0;
            task.originalTimeToday = 0;
        }
    }
    else {
        return response.status(400).json({ error: 'Missing necessary task arguments.' });
    }
    task.totalTimeToday = 0;
    task.user = user._id;
    const res = await task.save();
    user.tasks = user.tasks.concat({ id: res._id, active: false, startTime: -1 });
    await user.save();
    response.status(200).json({ task: res });
});
taskRouter.post('/startTask/:id', async (request, response) => {
    const id = request.params.id;
    if (!request.user) {
        return response.status(401).json({ error: 'User/token not found' });
    }
    const user = request.user;
    const task = await Task.findById(id);
    if (!task) {
        return response.status(404).json({ error: 'task not found' });
    }
    if (task.discrete) {
        return response.status(400).json({ error: 'discrete task cannot be started' });
    }
    if (user._id.toString() !== task.user) {
        return response.status(401).json({ error: 'task does not belong to user' });
    }
    const startTime = getCurrentEpochInSeconds();
    const userTaskIndex = user.tasks.findIndex(userTask => userTask.id.toString() === task._id.toString());
    if (userTaskIndex !== -1) {
        const userTask = user.tasks[userTaskIndex];
        if (userTask.startTime !== -1) {
            return response.status(400).json({ error: 'task already started' });
        }
        userTask.active = true;
        userTask.startTime = startTime;
        await user.save();
        return response.status(200).json({ startTime });
    }
    response.status(404).json({ error: 'task not found at id' });
});
taskRouter.post('/stopTask/:id', async (request, response) => {
    const id = request.params.id;
    if (!request.user) {
        return response.status(401).json({ error: 'User/token not found' });
    }
    const user = request.user;
    const stoppedTask = await Task.findById(id);
    if (!stoppedTask) {
        return response.status(404).json({ error: 'task not found' });
    }
    if (user._id.toString() !== stoppedTask.user) {
        return response.status(401).json({ error: 'task does not belong to user' });
    }
    const userTaskIndex = user.tasks.findIndex(userTask => userTask.id.toString() === stoppedTask._id.toString());
    if (userTaskIndex === -1) {
        return response.status(404).json({ error: 'user task not found' });
    }
    const userTask = user.tasks[userTaskIndex];
    if (!stoppedTask.discrete && !userTask.active) {
        return response.status(400).json({ error: 'task was never started' });
    }
    const time = getCurrentEpochInSeconds();
    const startTime = userTask.startTime;
    if (stoppedTask.discrete) {
        const { amount } = request.body;
        if (!amount) {
            return response.status(400).json({ error: 'No amount for count tasks provided.' });
        }
        if (!(stoppedTask.timeLeftToday <= 0)) {
            stoppedTask.timeLeftToday -= amount;
            if (stoppedTask.timeLeftToday < 0) {
                stoppedTask.timeLeftToday = 0;
            }
        }
        stoppedTask.totalTimeToday += amount;
    }
    else if (!(await checkIfTimeSurpassed(startTime, stoppedTask))) {
        const elapsedTime = (time - startTime) / 1000;
        stoppedTask.timeLeftToday -= (stoppedTask.timeLeftToday === 0 ? 0 : elapsedTime);
        stoppedTask.totalTimeToday += elapsedTime;
    }
    await stoppedTask.save();
    userTask.active = false;
    userTask.startTime = -1;
    await user.save();
    response.status(200).json({ startTime });
});
taskRouter.delete('/:id', async (request, response) => {
    const id = request.params.id;
    if (!request.user) {
        return response.status(401).json({ error: 'User/token not found' });
    }
    const user = request.user;
    const task = await Task.findById(id);
    if (!task) {
        return response.status(404).json({ error: 'task not found' });
    }
    if (user._id.toString() !== task.user) {
        return response.status(401).json({ error: 'task does not belong to user' });
    }
    await Task.findByIdAndDelete(id);
    user.tasks = user.tasks.filter(task => {
        return task.id.toString() !== id;
    });
    await user.save();
    response.status(200);
});
export default taskRouter;
