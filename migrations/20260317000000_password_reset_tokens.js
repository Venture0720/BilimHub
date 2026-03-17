'use strict';

exports.up = async function (knex) {
  await knex.schema.createTable('password_reset_tokens', (t) => {
    t.increments('id').primary();
    t.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.text('token_hash').notNullable().unique();
    t.timestamp('expires_at').notNullable();
    t.timestamp('used_at');
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  await knex.raw('CREATE INDEX idx_pwd_reset_user ON password_reset_tokens(user_id)');
  await knex.raw('CREATE INDEX idx_pwd_reset_hash ON password_reset_tokens(token_hash)');
  await knex.raw('CREATE INDEX idx_pwd_reset_expires ON password_reset_tokens(expires_at)');
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('password_reset_tokens');
};
