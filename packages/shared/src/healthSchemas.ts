import { z } from "zod";
import { NonEmptyTrimmedStringSchema, UtcIsoStringSchema } from "./entitySchemas.js";

const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD");
const HHMMSchema = z.string().regex(/^\d{2}:\d{2}$/, "must be HH:MM");

export const HealthHeartRateSchema = z.object({
  id: NonEmptyTrimmedStringSchema,
  date: DateSchema,
  restingHeartRate: z.number().int().nullable(),
  minHeartRate: z.number().int().nullable(),
  maxHeartRate: z.number().int().nullable(),
  avgHeartRate: z.number().int().nullable(),
  last7DaysAvgRestingHeartRate: z.number().int().nullable(),
  createdAt: UtcIsoStringSchema,
  updatedAt: UtcIsoStringSchema,
});
export type HealthHeartRate = z.infer<typeof HealthHeartRateSchema>;

export const HealthHrvSchema = z.object({
  id: NonEmptyTrimmedStringSchema,
  date: DateSchema,
  hrvMs: z.number().int(),
  createdAt: UtcIsoStringSchema,
  updatedAt: UtcIsoStringSchema,
});
export type HealthHrv = z.infer<typeof HealthHrvSchema>;

export const HealthSleepSchema = z.object({
  id: NonEmptyTrimmedStringSchema,
  date: DateSchema,
  sleepStart: HHMMSchema,
  wakeTime: HHMMSchema,
  adjustmentHours: z.number().int(),
  createdAt: UtcIsoStringSchema,
  updatedAt: UtcIsoStringSchema,
});
export type HealthSleep = z.infer<typeof HealthSleepSchema>;

export const HealthStressSchema = z.object({
  id: NonEmptyTrimmedStringSchema,
  date: DateSchema,
  stress: z.number().int(),
  createdAt: UtcIsoStringSchema,
  updatedAt: UtcIsoStringSchema,
});
export type HealthStress = z.infer<typeof HealthStressSchema>;

export const HealthRunSchema = z.object({
  id: NonEmptyTrimmedStringSchema,
  date: DateSchema,
  startTime: HHMMSchema,
  distanceKm: z.number().finite().nullable(),
  durationSeconds: z.number().int().nullable(),
  averageHeartRate: z.number().int().nullable(),
  averageCadence: z.number().finite().nullable(),
  averageStrideM: z.number().finite().nullable(),
  averageVerticalRatioPercent: z.number().finite().nullable(),
  averageVerticalOscillationCm: z.number().finite().nullable(),
  averageGroundContactMs: z.number().int().nullable(),
  type: z.string(),
  city: z.string(),
  createdAt: UtcIsoStringSchema,
  updatedAt: UtcIsoStringSchema,
});
export type HealthRun = z.infer<typeof HealthRunSchema>;
