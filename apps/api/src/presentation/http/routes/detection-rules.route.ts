import type { FastifyPluginAsync } from 'fastify';
import {
  CreateDetectionRuleRequestSchema,
  DetectionRuleListQuerySchema,
  UpdateDetectionRuleRequestSchema,
  type DetectionRuleCommand,
  type DetectionRuleResponse,
  type DetectionRuleSummary,
  type PaginatedResponse,
} from '@aegis/contracts';
import type { DetectionRuleDetails } from '../../../domain/detection-rule.js';
import type { ResolveAuthenticatedUser } from '../../../application/use-cases/resolve-authenticated-user.js';
import type { CreateDetectionRule } from '../../../application/use-cases/detection-rules/create-detection-rule.js';
import type { ListDetectionRules } from '../../../application/use-cases/detection-rules/list-detection-rules.js';
import type { GetDetectionRule } from '../../../application/use-cases/detection-rules/get-detection-rule.js';
import type { UpdateDetectionRule } from '../../../application/use-cases/detection-rules/update-detection-rule.js';
import type { DeleteDetectionRule } from '../../../application/use-cases/detection-rules/delete-detection-rule.js';
import { authenticate, currentUserOf } from '../authenticate.js';
import { toDetectionRuleResponse, toDetectionRuleSummary, toPaginatedResponse } from '../mappers.js';
import { WorkspaceParamsSchema, paramsOf, resourceParamsSchema } from '../route-params.js';

export interface DetectionRulesRouteOptions {
  readonly resolveAuthenticatedUser: ResolveAuthenticatedUser;
  readonly createDetectionRule: CreateDetectionRule;
  readonly listDetectionRules: ListDetectionRules;
  readonly getDetectionRule: GetDetectionRule;
  readonly updateDetectionRule: UpdateDetectionRule;
  readonly deleteDetectionRule: DeleteDetectionRule;
}

const RuleParamsSchema = resourceParamsSchema('ruleId');

const toDetails = (command: DetectionRuleCommand): DetectionRuleDetails => ({
  name: command.name,
  description: command.description,
  severity: command.severity,
  enabled: command.enabled,
  eventCategory: command.eventCategory,
  scope: command.scope,
  targetHostIds: command.hostIds,
  definition: command.definition,
});

/**
 * Detection rules are configuration only: these routes store and return
 * validated declarative definitions; nothing here evaluates them.
 */
export const detectionRulesRoute: FastifyPluginAsync<DetectionRulesRouteOptions> = async (app, options) => {
  app.addHook('preHandler', authenticate(options.resolveAuthenticatedUser));

  app.post('/workspaces/:workspaceId/detection-rules', async (request, reply) => {
    const { workspaceId } = paramsOf(WorkspaceParamsSchema, request);
    const command = CreateDetectionRuleRequestSchema.parse(request.body);
    const view = await options.createDetectionRule.execute(currentUserOf(request), workspaceId, toDetails(command));
    const body: DetectionRuleResponse = toDetectionRuleResponse(view);
    return reply.status(201).send(body);
  });

  app.get('/workspaces/:workspaceId/detection-rules', async (request): Promise<PaginatedResponse<DetectionRuleSummary>> => {
    const { workspaceId } = paramsOf(WorkspaceParamsSchema, request);
    const query = DetectionRuleListQuerySchema.parse(request.query);
    const page = await options.listDetectionRules.execute(currentUserOf(request), workspaceId, {
      page: query.page,
      pageSize: query.pageSize,
      search: query.q,
      severity: query.severity,
      eventCategory: query.eventCategory,
      enabled: query.enabled,
    });
    return toPaginatedResponse(page, toDetectionRuleSummary);
  });

  app.get('/workspaces/:workspaceId/detection-rules/:ruleId', async (request): Promise<DetectionRuleResponse> => {
    const { workspaceId, ruleId } = paramsOf(RuleParamsSchema, request);
    return toDetectionRuleResponse(await options.getDetectionRule.execute(currentUserOf(request), workspaceId, ruleId));
  });

  app.put('/workspaces/:workspaceId/detection-rules/:ruleId', async (request): Promise<DetectionRuleResponse> => {
    const { workspaceId, ruleId } = paramsOf(RuleParamsSchema, request);
    const command = UpdateDetectionRuleRequestSchema.parse(request.body);
    return toDetectionRuleResponse(await options.updateDetectionRule.execute(currentUserOf(request), workspaceId, ruleId, toDetails(command)));
  });

  app.delete('/workspaces/:workspaceId/detection-rules/:ruleId', async (request, reply) => {
    const { workspaceId, ruleId } = paramsOf(RuleParamsSchema, request);
    await options.deleteDetectionRule.execute(currentUserOf(request), workspaceId, ruleId);
    return reply.status(204).send();
  });
};
