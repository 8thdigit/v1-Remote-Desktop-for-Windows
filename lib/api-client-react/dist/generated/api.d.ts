import type { DataTag, DefinedInitialDataOptions, DefinedUseQueryResult, QueryClient, QueryKey, UndefinedInitialDataOptions, UseMutationOptions, UseMutationResult, UseQueryOptions, UseQueryResult } from '@tanstack/react-query';
import type { MsfwrCall, MsfwrCallList, MsfwrCallQuery, MsfwrCode, MsfwrInput, MsfwrInvite, MsfwrLink, MsfwrLinkCreate, MsfwrLinkRegister, MsfwrLinkStatus, MsfwrStandingKey, MsfwrTick, MsfwrViewer, GetMsfwrFrameParams, GetMsfwrLinkStatusParams, HealthStatus } from './api.schemas';
import { customFetch } from '../custom-fetch';
import type { ErrorType, BodyType } from '../custom-fetch';
type AwaitedInput<T> = PromiseLike<T> | T;
type Awaited<O> = O extends AwaitedInput<infer T> ? T : never;
type SecondParameter<T extends (...args: never) => unknown> = Parameters<T>[1];
export declare const getHealthCheckUrl: () => string;
/**
 * Returns server health status
 * @summary Health check
 */
export declare const healthCheck: (options?: Parameters<typeof customFetch>[1]) => Promise<HealthStatus>;
export declare const getHealthCheckQueryKey: () => readonly ["/api/healthz"];
export declare const getHealthCheckQueryOptions: <TData = Awaited<ReturnType<typeof healthCheck>>, TError = ErrorType<unknown>>(options?: {
    query?: Partial<UseQueryOptions<Awaited<ReturnType<typeof healthCheck>>, TError, TData>>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof healthCheck>>, TError, TData> & {
    queryKey: DataTag<QueryKey, TData, TError>;
};
export type HealthCheckQueryResult = NonNullable<Awaited<ReturnType<typeof healthCheck>>>;
export type HealthCheckQueryError = ErrorType<unknown>;
export declare function useHealthCheck<TData = Awaited<ReturnType<typeof healthCheck>>, TError = ErrorType<unknown>>(options: {
    query: Partial<UseQueryOptions<Awaited<ReturnType<typeof healthCheck>>, TError, TData>> & Pick<DefinedInitialDataOptions<Awaited<ReturnType<typeof healthCheck>>, TError, Awaited<ReturnType<typeof healthCheck>>>, 'initialData'>;
    request?: SecondParameter<typeof customFetch>;
}, queryClient?: QueryClient): DefinedUseQueryResult<TData, TError> & {
    queryKey: DataTag<QueryKey, TData, TError>;
};
export declare function useHealthCheck<TData = Awaited<ReturnType<typeof healthCheck>>, TError = ErrorType<unknown>>(options?: {
    query?: Partial<UseQueryOptions<Awaited<ReturnType<typeof healthCheck>>, TError, TData>> & Pick<UndefinedInitialDataOptions<Awaited<ReturnType<typeof healthCheck>>, TError, Awaited<ReturnType<typeof healthCheck>>>, 'initialData'>;
    request?: SecondParameter<typeof customFetch>;
}, queryClient?: QueryClient): UseQueryResult<TData, TError> & {
    queryKey: DataTag<QueryKey, TData, TError>;
};
export declare function useHealthCheck<TData = Awaited<ReturnType<typeof healthCheck>>, TError = ErrorType<unknown>>(options?: {
    query?: Partial<UseQueryOptions<Awaited<ReturnType<typeof healthCheck>>, TError, TData>>;
    request?: SecondParameter<typeof customFetch>;
}, queryClient?: QueryClient): UseQueryResult<TData, TError> & {
    queryKey: DataTag<QueryKey, TData, TError>;
};
export declare const getCreateMsfwrInviteUrl: () => string;
export declare const createMsfwrInvite: (options?: Parameters<typeof customFetch>[1]) => Promise<MsfwrInvite>;
export declare const getCreateMsfwrInviteMutationKey: () => readonly ["createMsfwrInvite"];
export declare const getCreateMsfwrInviteMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createMsfwrInvite>>, TError, void, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof createMsfwrInvite>>, TError, void, TContext>;
export type CreateMsfwrInviteMutationResult = NonNullable<Awaited<ReturnType<typeof createMsfwrInvite>>>;
export type CreateMsfwrInviteMutationError = ErrorType<unknown>;
export declare const useCreateMsfwrInvite: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createMsfwrInvite>>, TError, void, TContext>;
    request?: SecondParameter<typeof customFetch>;
}, queryClient?: QueryClient) => UseMutationResult<Awaited<ReturnType<typeof createMsfwrInvite>>, TError, void, TContext>;
export declare const getRegisterMsfwrStandingUrl: () => string;
/**
 * Unattended host registration. The access code is derived from the host's saved key; a viewer that joins it is live without approval.
 */
export declare const registerMsfwrStanding: (msfwrStandingKey: MsfwrStandingKey, options?: Parameters<typeof customFetch>[1]) => Promise<MsfwrInvite>;
export declare const getRegisterMsfwrStandingMutationKey: () => readonly ["registerMsfwrStanding"];
export declare const getRegisterMsfwrStandingMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof registerMsfwrStanding>>, TError, RegisterMsfwrStandingMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof registerMsfwrStanding>>, TError, RegisterMsfwrStandingMutationVariables, TContext>;
export type RegisterMsfwrStandingMutationResult = NonNullable<Awaited<ReturnType<typeof registerMsfwrStanding>>>;
export type RegisterMsfwrStandingMutationBody = BodyType<MsfwrStandingKey>;
export type RegisterMsfwrStandingMutationError = ErrorType<unknown>;
export type RegisterMsfwrStandingMutationVariables = {
    data: BodyType<MsfwrStandingKey>;
};
export declare const useRegisterMsfwrStanding: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof registerMsfwrStanding>>, TError, RegisterMsfwrStandingMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}, queryClient?: QueryClient) => UseMutationResult<Awaited<ReturnType<typeof registerMsfwrStanding>>, TError, RegisterMsfwrStandingMutationVariables, TContext>;
export declare const getCallMsfwrUrl: () => string;
/**
 * An unattended host presses Initiate. Viewers that already know its access code see the request for two minutes and accept it by joining.
 */
export declare const callMsfwr: (msfwrCall?: MsfwrCall, options?: Parameters<typeof customFetch>[1]) => Promise<void>;
export declare const getCallMsfwrMutationKey: () => readonly ["callMsfwr"];
export declare const getCallMsfwrMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof callMsfwr>>, TError, CallMsfwrMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof callMsfwr>>, TError, CallMsfwrMutationVariables, TContext>;
export type CallMsfwrMutationResult = NonNullable<Awaited<ReturnType<typeof callMsfwr>>>;
export type CallMsfwrMutationBody = BodyType<MsfwrCall> | undefined;
export type CallMsfwrMutationError = ErrorType<unknown>;
export type CallMsfwrMutationVariables = {
    data?: BodyType<MsfwrCall>;
};
export declare const useCallMsfwr: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof callMsfwr>>, TError, CallMsfwrMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}, queryClient?: QueryClient) => UseMutationResult<Awaited<ReturnType<typeof callMsfwr>>, TError, CallMsfwrMutationVariables, TContext>;
export declare const getListMsfwrCallsUrl: () => string;
/**
 * Which of the viewer's saved access codes have a pending Initiate request, and which of them are online (waiting) or in a session. Codes that are not listed are offline.
 */
export declare const listMsfwrCalls: (msfwrCallQuery: MsfwrCallQuery, options?: Parameters<typeof customFetch>[1]) => Promise<MsfwrCallList>;
export declare const getListMsfwrCallsMutationKey: () => readonly ["listMsfwrCalls"];
export declare const getListMsfwrCallsMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof listMsfwrCalls>>, TError, ListMsfwrCallsMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof listMsfwrCalls>>, TError, ListMsfwrCallsMutationVariables, TContext>;
export type ListMsfwrCallsMutationResult = NonNullable<Awaited<ReturnType<typeof listMsfwrCalls>>>;
export type ListMsfwrCallsMutationBody = BodyType<MsfwrCallQuery>;
export type ListMsfwrCallsMutationError = ErrorType<unknown>;
export type ListMsfwrCallsMutationVariables = {
    data: BodyType<MsfwrCallQuery>;
};
export declare const useListMsfwrCalls: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof listMsfwrCalls>>, TError, ListMsfwrCallsMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}, queryClient?: QueryClient) => UseMutationResult<Awaited<ReturnType<typeof listMsfwrCalls>>, TError, ListMsfwrCallsMutationVariables, TContext>;
export declare const getCreateMsfwrLinkUrl: () => string;
/**
 * Create a shareable remote access URL from the client app. The host PC registers a waiting session under the link's code; every viewer that opens the shared URL starts a new session without approval, until the link expires (24 hours by default) or is revoked. Requires the unattended access key of the PC.
 */
export declare const createMsfwrLink: (msfwrLinkCreate: MsfwrLinkCreate, options?: Parameters<typeof customFetch>[1]) => Promise<MsfwrLink>;
export declare const getCreateMsfwrLinkMutationKey: () => readonly ["createMsfwrLink"];
export declare const getCreateMsfwrLinkMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createMsfwrLink>>, TError, CreateMsfwrLinkMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof createMsfwrLink>>, TError, CreateMsfwrLinkMutationVariables, TContext>;
export type CreateMsfwrLinkMutationResult = NonNullable<Awaited<ReturnType<typeof createMsfwrLink>>>;
export type CreateMsfwrLinkMutationBody = BodyType<MsfwrLinkCreate>;
export type CreateMsfwrLinkMutationError = ErrorType<unknown>;
export type CreateMsfwrLinkMutationVariables = {
    data: BodyType<MsfwrLinkCreate>;
};
export declare const useCreateMsfwrLink: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createMsfwrLink>>, TError, CreateMsfwrLinkMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}, queryClient?: QueryClient) => UseMutationResult<Awaited<ReturnType<typeof createMsfwrLink>>, TError, CreateMsfwrLinkMutationVariables, TContext>;
export declare const getRegisterMsfwrLinkUrl: () => string;
/**
 * The host re-registers its waiting session under an existing link id after each session ends, so the shared URL keeps accepting viewers until it expires or is revoked.
 */
export declare const registerMsfwrLink: (msfwrLinkRegister: MsfwrLinkRegister, options?: Parameters<typeof customFetch>[1]) => Promise<MsfwrInvite>;
export declare const getRegisterMsfwrLinkMutationKey: () => readonly ["registerMsfwrLink"];
export declare const getRegisterMsfwrLinkMutationOptions: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof registerMsfwrLink>>, TError, RegisterMsfwrLinkMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof registerMsfwrLink>>, TError, RegisterMsfwrLinkMutationVariables, TContext>;
export type RegisterMsfwrLinkMutationResult = NonNullable<Awaited<ReturnType<typeof registerMsfwrLink>>>;
export type RegisterMsfwrLinkMutationBody = BodyType<MsfwrLinkRegister>;
export type RegisterMsfwrLinkMutationError = ErrorType<void>;
export type RegisterMsfwrLinkMutationVariables = {
    data: BodyType<MsfwrLinkRegister>;
};
export declare const useRegisterMsfwrLink: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof registerMsfwrLink>>, TError, RegisterMsfwrLinkMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}, queryClient?: QueryClient) => UseMutationResult<Awaited<ReturnType<typeof registerMsfwrLink>>, TError, RegisterMsfwrLinkMutationVariables, TContext>;
export declare const getGetMsfwrLinkStatusUrl: (params: GetMsfwrLinkStatusParams) => string;
/**
 * Current state of a link for the client app: validity, whether the host is registered and online, and how many sessions were opened.
 */
export declare const getMsfwrLinkStatus: (params: GetMsfwrLinkStatusParams, options?: Parameters<typeof customFetch>[1]) => Promise<MsfwrLinkStatus>;
export declare const getGetMsfwrLinkStatusQueryKey: (params?: GetMsfwrLinkStatusParams) => readonly ["/api/msfwr/link/status", ...GetMsfwrLinkStatusParams[]];
export declare const getGetMsfwrLinkStatusQueryOptions: <TData = Awaited<ReturnType<typeof getMsfwrLinkStatus>>, TError = ErrorType<unknown>>(params: GetMsfwrLinkStatusParams, options?: {
    query?: Partial<UseQueryOptions<Awaited<ReturnType<typeof getMsfwrLinkStatus>>, TError, TData>>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getMsfwrLinkStatus>>, TError, TData> & {
    queryKey: DataTag<QueryKey, TData, TError>;
};
export type GetMsfwrLinkStatusQueryResult = NonNullable<Awaited<ReturnType<typeof getMsfwrLinkStatus>>>;
export type GetMsfwrLinkStatusQueryError = ErrorType<unknown>;
export declare function useGetMsfwrLinkStatus<TData = Awaited<ReturnType<typeof getMsfwrLinkStatus>>, TError = ErrorType<unknown>>(params: GetMsfwrLinkStatusParams, options: {
    query: Partial<UseQueryOptions<Awaited<ReturnType<typeof getMsfwrLinkStatus>>, TError, TData>> & Pick<DefinedInitialDataOptions<Awaited<ReturnType<typeof getMsfwrLinkStatus>>, TError, Awaited<ReturnType<typeof getMsfwrLinkStatus>>>, 'initialData'>;
    request?: SecondParameter<typeof customFetch>;
}, queryClient?: QueryClient): DefinedUseQueryResult<TData, TError> & {
    queryKey: DataTag<QueryKey, TData, TError>;
};
export declare function useGetMsfwrLinkStatus<TData = Awaited<ReturnType<typeof getMsfwrLinkStatus>>, TError = ErrorType<unknown>>(params: GetMsfwrLinkStatusParams, options?: {
    query?: Partial<UseQueryOptions<Awaited<ReturnType<typeof getMsfwrLinkStatus>>, TError, TData>> & Pick<UndefinedInitialDataOptions<Awaited<ReturnType<typeof getMsfwrLinkStatus>>, TError, Awaited<ReturnType<typeof getMsfwrLinkStatus>>>, 'initialData'>;
    request?: SecondParameter<typeof customFetch>;
}, queryClient?: QueryClient): UseQueryResult<TData, TError> & {
    queryKey: DataTag<QueryKey, TData, TError>;
};
export declare function useGetMsfwrLinkStatus<TData = Awaited<ReturnType<typeof getMsfwrLinkStatus>>, TError = ErrorType<unknown>>(params: GetMsfwrLinkStatusParams, options?: {
    query?: Partial<UseQueryOptions<Awaited<ReturnType<typeof getMsfwrLinkStatus>>, TError, TData>>;
    request?: SecondParameter<typeof customFetch>;
}, queryClient?: QueryClient): UseQueryResult<TData, TError> & {
    queryKey: DataTag<QueryKey, TData, TError>;
};
export declare const getRevokeMsfwrLinkUrl: () => string;
/**
 * Revoke a link at once; any live session under it is ended.
 */
export declare const revokeMsfwrLink: (msfwrLinkRegister: MsfwrLinkRegister, options?: Parameters<typeof customFetch>[1]) => Promise<void>;
export declare const getRevokeMsfwrLinkMutationKey: () => readonly ["revokeMsfwrLink"];
export declare const getRevokeMsfwrLinkMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof revokeMsfwrLink>>, TError, RevokeMsfwrLinkMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof revokeMsfwrLink>>, TError, RevokeMsfwrLinkMutationVariables, TContext>;
export type RevokeMsfwrLinkMutationResult = NonNullable<Awaited<ReturnType<typeof revokeMsfwrLink>>>;
export type RevokeMsfwrLinkMutationBody = BodyType<MsfwrLinkRegister>;
export type RevokeMsfwrLinkMutationError = ErrorType<unknown>;
export type RevokeMsfwrLinkMutationVariables = {
    data: BodyType<MsfwrLinkRegister>;
};
export declare const useRevokeMsfwrLink: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof revokeMsfwrLink>>, TError, RevokeMsfwrLinkMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}, queryClient?: QueryClient) => UseMutationResult<Awaited<ReturnType<typeof revokeMsfwrLink>>, TError, RevokeMsfwrLinkMutationVariables, TContext>;
export declare const getJoinMsfwrUrl: () => string;
export declare const joinMsfwr: (msfwrCode: MsfwrCode, options?: Parameters<typeof customFetch>[1]) => Promise<MsfwrViewer>;
export declare const getJoinMsfwrMutationKey: () => readonly ["joinMsfwr"];
export declare const getJoinMsfwrMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof joinMsfwr>>, TError, JoinMsfwrMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof joinMsfwr>>, TError, JoinMsfwrMutationVariables, TContext>;
export type JoinMsfwrMutationResult = NonNullable<Awaited<ReturnType<typeof joinMsfwr>>>;
export type JoinMsfwrMutationBody = BodyType<MsfwrCode>;
export type JoinMsfwrMutationError = ErrorType<unknown>;
export type JoinMsfwrMutationVariables = {
    data: BodyType<MsfwrCode>;
};
export declare const useJoinMsfwr: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof joinMsfwr>>, TError, JoinMsfwrMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}, queryClient?: QueryClient) => UseMutationResult<Awaited<ReturnType<typeof joinMsfwr>>, TError, JoinMsfwrMutationVariables, TContext>;
export declare const getEndMsfwrUrl: () => string;
export declare const endMsfwr: (options?: Parameters<typeof customFetch>[1]) => Promise<void>;
export declare const getEndMsfwrMutationKey: () => readonly ["endMsfwr"];
export declare const getEndMsfwrMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof endMsfwr>>, TError, void, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof endMsfwr>>, TError, void, TContext>;
export type EndMsfwrMutationResult = NonNullable<Awaited<ReturnType<typeof endMsfwr>>>;
export type EndMsfwrMutationError = ErrorType<unknown>;
export declare const useEndMsfwr: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof endMsfwr>>, TError, void, TContext>;
    request?: SecondParameter<typeof customFetch>;
}, queryClient?: QueryClient) => UseMutationResult<Awaited<ReturnType<typeof endMsfwr>>, TError, void, TContext>;
export declare const getSendMsfwrInputUrl: () => string;
export declare const sendMsfwrInput: (msfwrInput: MsfwrInput, options?: Parameters<typeof customFetch>[1]) => Promise<void>;
export declare const getSendMsfwrInputMutationKey: () => readonly ["sendMsfwrInput"];
export declare const getSendMsfwrInputMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof sendMsfwrInput>>, TError, SendMsfwrInputMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof sendMsfwrInput>>, TError, SendMsfwrInputMutationVariables, TContext>;
export type SendMsfwrInputMutationResult = NonNullable<Awaited<ReturnType<typeof sendMsfwrInput>>>;
export type SendMsfwrInputMutationBody = BodyType<MsfwrInput>;
export type SendMsfwrInputMutationError = ErrorType<unknown>;
export type SendMsfwrInputMutationVariables = {
    data: BodyType<MsfwrInput>;
};
export declare const useSendMsfwrInput: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof sendMsfwrInput>>, TError, SendMsfwrInputMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}, queryClient?: QueryClient) => UseMutationResult<Awaited<ReturnType<typeof sendMsfwrInput>>, TError, SendMsfwrInputMutationVariables, TContext>;
export declare const getApproveMsfwrUrl: () => string;
export declare const approveMsfwr: (options?: Parameters<typeof customFetch>[1]) => Promise<void>;
export declare const getApproveMsfwrMutationKey: () => readonly ["approveMsfwr"];
export declare const getApproveMsfwrMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof approveMsfwr>>, TError, void, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof approveMsfwr>>, TError, void, TContext>;
export type ApproveMsfwrMutationResult = NonNullable<Awaited<ReturnType<typeof approveMsfwr>>>;
export type ApproveMsfwrMutationError = ErrorType<unknown>;
export declare const useApproveMsfwr: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof approveMsfwr>>, TError, void, TContext>;
    request?: SecondParameter<typeof customFetch>;
}, queryClient?: QueryClient) => UseMutationResult<Awaited<ReturnType<typeof approveMsfwr>>, TError, void, TContext>;
export declare const getTickMsfwrUrl: () => string;
/**
 * Host heartbeat; optional raw JPEG body when the approved screen changes.
 */
export declare const tickMsfwr: (tickMsfwrBody?: Blob, options?: Parameters<typeof customFetch>[1]) => Promise<MsfwrTick>;
export declare const getTickMsfwrMutationKey: () => readonly ["tickMsfwr"];
export declare const getTickMsfwrMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof tickMsfwr>>, TError, TickMsfwrMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof tickMsfwr>>, TError, TickMsfwrMutationVariables, TContext>;
export type TickMsfwrMutationResult = NonNullable<Awaited<ReturnType<typeof tickMsfwr>>>;
export type TickMsfwrMutationBody = BodyType<Blob> | undefined;
export type TickMsfwrMutationError = ErrorType<unknown>;
export type TickMsfwrMutationVariables = {
    data?: BodyType<Blob>;
};
export declare const useTickMsfwr: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof tickMsfwr>>, TError, TickMsfwrMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}, queryClient?: QueryClient) => UseMutationResult<Awaited<ReturnType<typeof tickMsfwr>>, TError, TickMsfwrMutationVariables, TContext>;
export declare const getGetMsfwrFrameUrl: (params?: GetMsfwrFrameParams) => string;
export declare const getMsfwrFrame: (params?: GetMsfwrFrameParams, options?: Parameters<typeof customFetch>[1]) => Promise<Blob | void>;
export declare const getGetMsfwrFrameQueryKey: (params?: GetMsfwrFrameParams) => readonly ["/api/msfwr/frame", ...GetMsfwrFrameParams[]];
export declare const getGetMsfwrFrameQueryOptions: <TData = Awaited<ReturnType<typeof getMsfwrFrame>>, TError = ErrorType<unknown>>(params?: GetMsfwrFrameParams, options?: {
    query?: Partial<UseQueryOptions<Awaited<ReturnType<typeof getMsfwrFrame>>, TError, TData>>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getMsfwrFrame>>, TError, TData> & {
    queryKey: DataTag<QueryKey, TData, TError>;
};
export type GetMsfwrFrameQueryResult = NonNullable<Awaited<ReturnType<typeof getMsfwrFrame>>>;
export type GetMsfwrFrameQueryError = ErrorType<unknown>;
export declare function useGetMsfwrFrame<TData = Awaited<ReturnType<typeof getMsfwrFrame>>, TError = ErrorType<unknown>>(params: undefined | GetMsfwrFrameParams, options: {
    query: Partial<UseQueryOptions<Awaited<ReturnType<typeof getMsfwrFrame>>, TError, TData>> & Pick<DefinedInitialDataOptions<Awaited<ReturnType<typeof getMsfwrFrame>>, TError, Awaited<ReturnType<typeof getMsfwrFrame>>>, 'initialData'>;
    request?: SecondParameter<typeof customFetch>;
}, queryClient?: QueryClient): DefinedUseQueryResult<TData, TError> & {
    queryKey: DataTag<QueryKey, TData, TError>;
};
export declare function useGetMsfwrFrame<TData = Awaited<ReturnType<typeof getMsfwrFrame>>, TError = ErrorType<unknown>>(params?: GetMsfwrFrameParams, options?: {
    query?: Partial<UseQueryOptions<Awaited<ReturnType<typeof getMsfwrFrame>>, TError, TData>> & Pick<UndefinedInitialDataOptions<Awaited<ReturnType<typeof getMsfwrFrame>>, TError, Awaited<ReturnType<typeof getMsfwrFrame>>>, 'initialData'>;
    request?: SecondParameter<typeof customFetch>;
}, queryClient?: QueryClient): UseQueryResult<TData, TError> & {
    queryKey: DataTag<QueryKey, TData, TError>;
};
export declare function useGetMsfwrFrame<TData = Awaited<ReturnType<typeof getMsfwrFrame>>, TError = ErrorType<unknown>>(params?: GetMsfwrFrameParams, options?: {
    query?: Partial<UseQueryOptions<Awaited<ReturnType<typeof getMsfwrFrame>>, TError, TData>>;
    request?: SecondParameter<typeof customFetch>;
}, queryClient?: QueryClient): UseQueryResult<TData, TError> & {
    queryKey: DataTag<QueryKey, TData, TError>;
};
export {};
//# sourceMappingURL=api.d.ts.map