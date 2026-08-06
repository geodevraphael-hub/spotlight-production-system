import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("planner"),
  createdAt: integer("created_at").notNull(),
});

export const sessions = sqliteTable("sessions", {
  token: text("token").primaryKey(),
  userId: integer("user_id").notNull(),
  expiresAt: integer("expires_at").notNull(),
});

export const inventory = sqliteTable("inventory", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sourceId: integer("source_id"),
  data: text("data").notNull(),
  latitude: integer("latitude").notNull(),
  longitude: integer("longitude").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const plans = sqliteTable("plans", {
  userId: integer("user_id").primaryKey(),
  data: text("data").notNull(),
  note: text("note").notNull().default(""),
  updatedAt: integer("updated_at").notNull(),
});

export const projects = sqliteTable("projects", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  projectType: text("project_type").notNull(),
  shareToken: text("share_token").notNull().unique(),
  shareCode: text("share_code").notNull().default(""),
  shareProtected: integer("share_protected").notNull().default(1),
  createdBy: integer("created_by").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const projectUsers = sqliteTable("project_users", {
  projectId: integer("project_id").notNull(),
  userId: integer("user_id").notNull(),
});

export const campaignPlans = sqliteTable("campaign_plans", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id").notNull(),
  userId: integer("user_id").notNull(),
  name: text("name").notNull(),
  data: text("data").notNull(),
  note: text("note").notNull().default(""),
  updatedAt: integer("updated_at").notNull(),
});

export const missions = sqliteTable("missions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id").notNull().default(1),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  status: text("status").notNull().default("active"),
  config: text("config").notNull().default("{}"),
  boundaryId: integer("boundary_id"),
  assignedUsers: text("assigned_users").notNull().default("[]"),
  assignedGroups: text("assigned_groups").notNull().default("[]"),
  createdBy: integer("created_by").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const fieldCollections = sqliteTable("field_collections", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id").notNull().default(1),
  missionId: integer("mission_id").notNull(),
  userId: integer("user_id").notNull(),
  status: text("status").notNull().default("pending"),
  data: text("data").notNull(),
  latitude: integer("latitude").notNull(),
  longitude: integer("longitude").notNull(),
  accuracy: integer("accuracy").default(0),
  validatedBy: integer("validated_by"),
  validatedAt: integer("validated_at"),
  createdAt: integer("created_at").notNull(),
});
