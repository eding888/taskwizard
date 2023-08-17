import mongoose from 'mongoose';
import uniqueValidator from 'mongoose-unique-validator';
import { validateDays } from '../utils/dayOfWeekHelper.js';

export interface Date {
  month: number;
  day: number;
  year: number;
}

export interface RecurringOptions {
  debt: number,
  timePerWeek: number // seconds
}

export interface DeadlineOptions {
  deadline: Date,
  timeRemaining: number // seconds
}

export type TaskType = 'deadline' | 'recurring';

export interface TaskInterface extends mongoose.Document {
  _id: string,
  name: string,
  type: TaskType,
  deadlineOptions: DeadlineOptions,
  recurringOptions: RecurringOptions,
  daysOfWeek: number[],
  totalTimeToday: number, // seconds
  timeLeftToday: number, // seconds
  daysOld: number,
  user: string
}
const taskSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['deadline', 'recurring'],
    required: [true, 'Task type is required']
  },
  name: {
    type: String,
    required: [true, 'Task name is required']
  },
  deadlineOptions: {
    type: {
      deadline: {
        month: Number,
        day: Number,
        year: Number
      },
      timeRemaining: Number
    },
    default: null
  },
  recurringOptions: {
    type: {
      debt: Number,
      timePerWeek: Number
    },
    default: null
  },
  daysOfWeek: {
    type: [Number],
    required: [true, 'Days of week are required']
  },
  timeLeftToday: {
    type: Number,
    deafult: 0
  },
  daysOld: {
    type: Number,
    deafult: 0
  },
  user: {
    type: String,
    ref: 'User'
  }
});

taskSchema.set('toJSON', {
  transform: (document, returnedObject) => {
    returnedObject.id = returnedObject._id.toString();
    delete returnedObject._id;
  }
});

taskSchema.plugin(uniqueValidator);

taskSchema.pre('save', function (next) {
  if (this.recurringOptions === null && this.deadlineOptions === null) {
    const error = new Error('Options must be provided for Task');
    return next(error);
  }
  if ((this.type === 'deadline' && this.deadlineOptions === null) || (this.type === 'recurring' && this.recurringOptions === null)) {
    const error = new Error('Incorrect options provided');
    return next(error);
  }
  if (!validateDays(this.daysOfWeek)) {
    const error = new Error('Days of week not formatted correctly');
    return next(error);
  }
  next();
});

const Task = mongoose.model<TaskInterface>('Task', taskSchema);

export default Task;