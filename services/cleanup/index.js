// services/cleanup/index.js
// Data Cleanup Orchestrator - координирует все cleanup операции

'use strict';
const { db } = require('../../database');

class CleanupOrchestrator {
  constructor() {}

  /**
   * Ежедневная очистка (3:00 AM)
   * - Удаление прочитанных уведомлений старше 90 дней
   * - Удаление истёкших refresh tokens
   * - Удаление истёкших invite tokens
   */
  async runDaily() {
    const startTime = Date.now();
    console.log('🗑️ Starting daily cleanup...');

    const results = {
      started_at: new Date().toISOString(),
      operations: [],
      total_records_deleted: 0,
      errors: []
    };

    try {
      // 1. Cleanup прочитанных уведомлений (старше 90 дней)
      const notifResult = await this.cleanupReadNotifications(90);
      results.operations.push(notifResult);
      results.total_records_deleted += notifResult.records_deleted;

      // 2. Cleanup истёкших refresh tokens
      const refreshResult = await this.cleanupExpiredRefreshTokens();
      results.operations.push(refreshResult);
      results.total_records_deleted += refreshResult.records_deleted;

      // 3. Cleanup истёкших invite tokens
      const inviteResult = await this.cleanupExpiredInviteTokens();
      results.operations.push(inviteResult);
      results.total_records_deleted += inviteResult.records_deleted;

      // 4. Удаление использованных invite tokens старше 1 года
      const usedInviteResult = await this.cleanupUsedInviteTokens(365);
      results.operations.push(usedInviteResult);
      results.total_records_deleted += usedInviteResult.records_deleted;

    } catch (error) {
      console.error('❌ Daily cleanup error:', error);
      results.errors.push(error.message);
    }

    results.completed_at = new Date().toISOString();
    results.duration_ms = Date.now() - startTime;

    // Логируем результаты
    await this.logCleanupHistory('daily', results);

    console.log(`✅ Daily cleanup completed in ${results.duration_ms}ms`);
    console.log(`   Deleted ${results.total_records_deleted} records`);

    return results;
  }

  /**
   * Еженедельная очистка (воскресенье 4:00 AM)
   * - Удаление непрочитанных уведомлений старше 1 года
   * - Мягкое удаление старых заданий
   */
  async runWeekly() {
    const startTime = Date.now();
    console.log('🗑️ Starting weekly cleanup...');

    const results = {
      started_at: new Date().toISOString(),
      operations: [],
      total_records_deleted: 0,
      errors: []
    };

    try {
      // 1. Cleanup непрочитанных уведомлений (старше 1 года)
      const unreadNotifResult = await this.cleanupUnreadNotifications(365);
      results.operations.push(unreadNotifResult);
      results.total_records_deleted += unreadNotifResult.records_deleted;

      // 2. Системные уведомления (старше 30 дней)
      const systemNotifResult = await this.cleanupSystemNotifications(30);
      results.operations.push(systemNotifResult);
      results.total_records_deleted += systemNotifResult.records_deleted;

    } catch (error) {
      console.error('❌ Weekly cleanup error:', error);
      results.errors.push(error.message);
    }

    results.completed_at = new Date().toISOString();
    results.duration_ms = Date.now() - startTime;

    await this.logCleanupHistory('weekly', results);

    console.log(`✅ Weekly cleanup completed in ${results.duration_ms}ms`);
    console.log(`   Deleted ${results.total_records_deleted} records`);

    return results;
  }

  /**
   * Ежемесячная очистка (1-е число 5:00 AM)
   * - Архивирование audit logs
   * - Поиск и удаление orphaned files
   * - VACUUM database
   */
  async runMonthly() {
    const startTime = Date.now();
    console.log('🗑️ Starting monthly cleanup...');

    const results = {
      started_at: new Date().toISOString(),
      operations: [],
      total_records_deleted: 0,
      errors: []
    };

    try {
      // 1. Prune audit_logs older than retention period (default 365 days)
      const auditResult = await this.pruneAuditLogs(parseInt(process.env.AUDIT_RETENTION_DAYS || 365));
      results.operations.push(auditResult);
      results.total_records_deleted += auditResult.records_deleted;

    } catch (error) {
      console.error('❌ Monthly cleanup error:', error);
      results.errors.push(error.message);
    }

    results.completed_at = new Date().toISOString();
    results.duration_ms = Date.now() - startTime;

    await this.logCleanupHistory('monthly', results);

    return results;
  }

  // ============================================================================
  // CLEANUP METHODS
  // ============================================================================

  /**
   * Prune audit_logs older than N days
   */
  async pruneAuditLogs(daysOld) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);
    const cutoffISO = cutoffDate.toISOString();

    try {
      const result = await db.run(`
        DELETE FROM audit_logs
        WHERE created_at < ?
      `, [cutoffISO]);

      return {
        operation: 'prune_audit_logs',
        records_deleted: result.changes,
        cutoff_date: cutoffISO,
        status: 'success'
      };
    } catch (error) {
      console.error('Error pruning audit logs:', error);
      return {
        operation: 'prune_audit_logs',
        records_deleted: 0,
        status: 'error',
        error: error.message
      };
    }
  }

  /**
   * Удаление прочитанных уведомлений старше N дней
   */
  async cleanupReadNotifications(daysOld) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);
    const cutoffISO = cutoffDate.toISOString();

    try {
      const result = await db.run(`
        DELETE FROM notifications
        WHERE is_read = 1
        AND created_at < ?
      `, [cutoffISO]);

      return {
        operation: 'cleanup_read_notifications',
        records_deleted: result.changes,
        cutoff_date: cutoffISO,
        status: 'success'
      };
    } catch (error) {
      console.error('Error cleaning read notifications:', error);
      return {
        operation: 'cleanup_read_notifications',
        records_deleted: 0,
        status: 'error',
        error: error.message
      };
    }
  }

  /**
   * Удаление непрочитанных уведомлений старше N дней
   */
  async cleanupUnreadNotifications(daysOld) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);
    const cutoffISO = cutoffDate.toISOString();

    try {
      const result = await db.run(`
        DELETE FROM notifications
        WHERE is_read = 0
        AND created_at < ?
      `, [cutoffISO]);

      return {
        operation: 'cleanup_unread_notifications',
        records_deleted: result.changes,
        cutoff_date: cutoffISO,
        status: 'success'
      };
    } catch (error) {
      console.error('Error cleaning unread notifications:', error);
      return {
        operation: 'cleanup_unread_notifications',
        records_deleted: 0,
        status: 'error',
        error: error.message
      };
    }
  }

  /**
   * Удаление системных уведомлений старше N дней
   * (Типа: info, не критичные)
   */
  async cleanupSystemNotifications(daysOld) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);
    const cutoffISO = cutoffDate.toISOString();

    try {
      const result = await db.run(`
        DELETE FROM notifications
        WHERE type = 'info'
        AND created_at < ?
      `, [cutoffISO]);

      return {
        operation: 'cleanup_system_notifications',
        records_deleted: result.changes,
        cutoff_date: cutoffISO,
        status: 'success'
      };
    } catch (error) {
      console.error('Error cleaning system notifications:', error);
      return {
        operation: 'cleanup_system_notifications',
        records_deleted: 0,
        status: 'error',
        error: error.message
      };
    }
  }

  /**
   * Удаление истёкших refresh tokens
   */
  async cleanupExpiredRefreshTokens() {
    const now = new Date().toISOString();

    try {
      const result = await db.run(`
        DELETE FROM refresh_tokens
        WHERE expires_at < ?
      `, [now]);

      return {
        operation: 'cleanup_expired_refresh_tokens',
        records_deleted: result.changes,
        status: 'success'
      };
    } catch (error) {
      console.error('Error cleaning expired refresh tokens:', error);
      return {
        operation: 'cleanup_expired_refresh_tokens',
        records_deleted: 0,
        status: 'error',
        error: error.message
      };
    }
  }

  /**
   * Удаление истёкших (неиспользованных) invite tokens
   */
  async cleanupExpiredInviteTokens() {
    const now = new Date().toISOString();

    try {
      const result = await db.run(`
        DELETE FROM invite_tokens
        WHERE expires_at < ?
        AND used_by IS NULL
      `, [now]);

      return {
        operation: 'cleanup_expired_invite_tokens',
        records_deleted: result.changes,
        status: 'success'
      };
    } catch (error) {
      console.error('Error cleaning expired invite tokens:', error);
      return {
        operation: 'cleanup_expired_invite_tokens',
        records_deleted: 0,
        status: 'error',
        error: error.message
      };
    }
  }

  /**
   * Удаление использованных invite tokens старше N дней
   */
  async cleanupUsedInviteTokens(daysOld) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);
    const cutoffISO = cutoffDate.toISOString();

    try {
      const result = await db.run(`
        DELETE FROM invite_tokens
        WHERE used_by IS NOT NULL
        AND used_at < ?
      `, [cutoffISO]);

      return {
        operation: 'cleanup_used_invite_tokens',
        records_deleted: result.changes,
        cutoff_date: cutoffISO,
        status: 'success'
      };
    } catch (error) {
      console.error('Error cleaning used invite tokens:', error);
      return {
        operation: 'cleanup_used_invite_tokens',
        records_deleted: 0,
        status: 'error',
        error: error.message
      };
    }
  }

  // ============================================================================
  // LOGGING
  // ============================================================================

  /**
   * Логирование истории cleanup операций
   */
  async logCleanupHistory(cleanupType, results) {
    try {
      await db.run(`
        INSERT INTO cleanup_history
        (cleanup_type, records_affected, status, details, executed_by, started_at, completed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [
        cleanupType,
        results.total_records_deleted || 0,
        results.errors.length > 0 ? 'partial' : 'success',
        JSON.stringify(results),
        'system_cron',
        results.started_at,
        results.completed_at
      ]);
    } catch (error) {
      console.error('Error logging cleanup history:', error);
    }
  }

  /**
   * Получить статистику cleanup за период
   */
  async getCleanupStats(days = 30) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    try {
      const stats = await db.get(`
        SELECT
          COUNT(*) as total_runs,
          SUM(records_affected) as total_records_deleted,
          AVG(records_affected) as avg_records_per_run,
          MAX(records_affected) as max_records,
          SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as successful_runs
        FROM cleanup_history
        WHERE started_at > ?
      `, [cutoffDate.toISOString()]);

      return stats;
    } catch (error) {
      console.error('Error getting cleanup stats:', error);
      return null;
    }
  }
}

module.exports = CleanupOrchestrator;

