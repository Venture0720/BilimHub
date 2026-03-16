'use strict';

// Adds teacher-resource file columns to the assignments table.
// These store the Vercel Blob CDN URL (or null if no file attached).

exports.up = async function (knex) {
  await knex.schema.alterTable('assignments', (t) => {
    t.text('file_path').nullable();
    t.text('file_name').nullable();
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('assignments', (t) => {
    t.dropColumn('file_path');
    t.dropColumn('file_name');
  });
};
