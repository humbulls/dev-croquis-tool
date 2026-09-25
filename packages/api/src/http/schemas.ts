/**
 * Named OpenAPI components. The contract itself lives in @croquis/shared (plain
 * Zod, shared with the dashboard, widget and MCP server); this file only gives
 * each schema a stable component name in /api/v1/openapi.json.
 */
import * as s from '@croquis/shared';
import { z } from '@hono/zod-openapi';

const named = <T extends z.ZodType>(name: string, schema: T): T => schema.openapi(name) as T;

// Identity & workspaces
export const UserSummary = named('UserSummary', s.userSummarySchema);
export const Workspace = named('Workspace', s.workspaceSchema);
export const Me = named('Me', s.meSchema);
export const Member = named('Member', s.memberSchema);
export const Invitation = named('Invitation', s.invitationSchema);
export const CreatedInvitation = named('CreatedInvitation', s.createdInvitationSchema);
export const InvitationPreview = named('InvitationPreview', s.invitationPreviewSchema);
export const ApiKey = named('ApiKey', s.apiKeySchema);
export const CreatedApiKey = named('CreatedApiKey', s.createdApiKeySchema);
export const SetupStatus = named('SetupStatus', s.setupStatusSchema);

export const CreateWorkspaceInput = named('CreateWorkspaceInput', s.createWorkspaceInput);
export const UpdateWorkspaceInput = named('UpdateWorkspaceInput', s.updateWorkspaceInput);
export const UpdateMemberInput = named('UpdateMemberInput', s.updateMemberInput);
export const CreateInvitationInput = named('CreateInvitationInput', s.createInvitationInput);
export const CreateApiKeyInput = named('CreateApiKeyInput', s.createApiKeyInput);
export const SetupInput = named('SetupInput', s.setupInput);

// Projects
export const Project = named('Project', s.projectSchema);
export const ProjectWithStats = named('ProjectWithStats', s.projectWithStatsSchema);
export const ProjectOrigin = named('ProjectOrigin', s.projectOriginSchema);
export const ShareLink = named('ShareLink', s.shareLinkSchema);
export const Label = named('Label', s.labelSchema);
export const CreateProjectInput = named('CreateProjectInput', s.createProjectInput);
export const UpdateProjectInput = named('UpdateProjectInput', s.updateProjectInput);
export const CreateOriginInput = named('CreateOriginInput', s.createOriginInput);
export const CreateShareLinkInput = named('CreateShareLinkInput', s.createShareLinkInput);
export const UpdateShareLinkInput = named('UpdateShareLinkInput', s.updateShareLinkInput);
export const CreateLabelInput = named('CreateLabelInput', s.createLabelInput);
export const UpdateLabelInput = named('UpdateLabelInput', s.updateLabelInput);

// Pages & content
export const Page = named('Page', s.pageSchema);
export const PageWithStats = named('PageWithStats', s.pageWithStatsSchema);
export const ContentBlock = named('ContentBlock', s.contentBlockSchema);
export const ReviewRound = named('ReviewRound', s.reviewRoundSchema);
export const PageApproval = named('PageApproval', s.pageApprovalSchema);
export const CreatePageInput = named('CreatePageInput', s.createPageInput);
export const UpdatePageInput = named('UpdatePageInput', s.updatePageInput);
export const ReorderPagesInput = named('ReorderPagesInput', s.reorderPagesInput);
export const CreateContentBlockInput = named('CreateContentBlockInput', s.createContentBlockInput);
export const UpdateContentBlockInput = named('UpdateContentBlockInput', s.updateContentBlockInput);
export const CreateReviewRoundInput = named('CreateReviewRoundInput', s.createReviewRoundInput);
export const CreateApprovalInput = named('CreateApprovalInput', s.createApprovalInput);

// Comments
export const Comment = named('Comment', s.commentSchema);
export const CommentDetail = named('CommentDetail', s.commentDetailSchema);
export const Reply = named('Reply', s.replySchema);
export const Attachment = named('Attachment', s.attachmentSchema);
export const CommentCounts = named('CommentCounts', s.commentCountsSchema);
export const CreateCommentInput = named('CreateCommentInput', s.createCommentInput);
export const UpdateCommentInput = named('UpdateCommentInput', s.updateCommentInput);
export const FixCommentInput = named('FixCommentInput', s.fixCommentInput);
export const CreateReplyInput = named('CreateReplyInput', s.createReplyInput);
export const IngestCommentInput = named('IngestCommentInput', s.ingestCommentInput);
export const IngestResult = named('IngestResult', s.ingestResultSchema);
export const PublicComment = named('PublicComment', s.publicCommentSchema);

// Share viewer
export const ShareMeta = named('ShareMeta', s.shareMetaSchema);
export const ShareSessionInput = named('ShareSessionInput', s.shareSessionInput);
export const ShareSession = named('ShareSession', s.shareSessionSchema);
export const SharePage = named('SharePage', s.sharePageSchema);
export const ShareCommentDetail = named('ShareCommentDetail', s.shareCommentDetailSchema);
export const ShareReplyInput = named('ShareReplyInput', s.shareReplyInput);

// Platform
export const ActivityEvent = named('ActivityEvent', s.activityEventSchema);
export const WebhookEndpoint = named('WebhookEndpoint', s.webhookEndpointSchema);
export const CreatedWebhook = named('CreatedWebhook', s.createdWebhookSchema);
export const WebhookDelivery = named('WebhookDelivery', s.webhookDeliverySchema);
export const CreateWebhookInput = named('CreateWebhookInput', s.createWebhookInput);
export const UpdateWebhookInput = named('UpdateWebhookInput', s.updateWebhookInput);
export const Integration = named('Integration', s.integrationSchema);
export const UpsertIntegrationInput = named('UpsertIntegrationInput', s.upsertIntegrationInput);
export const ExternalLink = named('ExternalLink', s.externalLinkSchema);
export const AiRun = named('AiRun', s.aiRunSchema);
export const AiDigest = named('AiDigest', s.aiDigestSchema);
export const AiTriage = named('AiTriage', s.aiTriageSchema);
export const AiTypoCheck = named('AiTypoCheck', s.aiTypoCheckSchema);
export const AiTranslation = named('AiTranslation', s.aiTranslationSchema);
export const ProjectExport = named('ProjectExport', s.projectExportSchema);

export const data = <T extends z.ZodType>(item: T) => z.object({ data: z.array(item) });
export const paginated = <T extends z.ZodType>(item: T) =>
  z.object({ data: z.array(item), next_cursor: z.string().nullable() });
