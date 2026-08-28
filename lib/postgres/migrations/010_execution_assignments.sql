CREATE UNIQUE INDEX tasks_execution_assignment_unique
  ON tasks (workspace_id, (payload ->> 'parentTaskId'), (payload ->> 'assigneeIdentityId'))
  WHERE payload ->> 'taskType' = 'execution';
