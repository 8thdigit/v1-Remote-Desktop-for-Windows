import type { DataTag, DefinedInitialDataOptions, DefinedUseQueryResult, QueryClient, QueryKey, UndefinedInitialDataOptions, UseMutationOptions, UseMutationResult, UseQueryOptions, UseQueryResult } from '@tanstack/react-query';
import type { Account, AccountCreate, AccountList, AccountUpdate, AdminOverview, AuthLogin, AuthStatus, GetMsfwrFrameParams, GetMsfwrLinkInfoParams, GetMsfwrLinkStatusParams, HealthStatus, MsfwrAccept, MsfwrCall, MsfwrCallList, MsfwrCallQuery, MsfwrCode, MsfwrConnectPc, MsfwrInbox, MsfwrInput, MsfwrInvite, MsfwrLink, MsfwrLinkCreate, MsfwrLinkInfo, MsfwrLinkJoin, MsfwrLinkRegister, MsfwrLinkStatus, MsfwrStandingKey, MsfwrTick, MsfwrViewer, PasswordChange } from './api.schemas';
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
 * Create a shareable remote access URL from the client app, with a six-digit access code. Whoever opens the URL and enters the code connects to the PC without a prompt, until the link expires (24 hours by default) or is cleared on the PC. Requires the PC's unattended access key.
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
 * The PC sends its saved link again each time it registers, so the link is restored if the relay restarted. Only the PC that owns the link can restore it, because the link's code is derived from its key.
 */
export declare const registerMsfwrLink: (msfwrLinkRegister: MsfwrLinkRegister, options?: Parameters<typeof customFetch>[1]) => Promise<MsfwrLink>;
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
export declare const getGetMsfwrLinkInfoUrl: (params: GetMsfwrLinkInfoParams) => string;
/**
 * Public facts about a shared remote access URL, for the page it opens: the PC name, whether the PC is online, and when the link expires.
 */
export declare const getMsfwrLinkInfo: (params: GetMsfwrLinkInfoParams, options?: Parameters<typeof customFetch>[1]) => Promise<MsfwrLinkInfo>;
export declare const getGetMsfwrLinkInfoQueryKey: (params?: GetMsfwrLinkInfoParams) => readonly ["/api/msfwr/link/info", ...GetMsfwrLinkInfoParams[]];
export declare const getGetMsfwrLinkInfoQueryOptions: <TData = Awaited<ReturnType<typeof getMsfwrLinkInfo>>, TError = ErrorType<void>>(params: GetMsfwrLinkInfoParams, options?: {
    query?: Partial<UseQueryOptions<Awaited<ReturnType<typeof getMsfwrLinkInfo>>, TError, TData>>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getMsfwrLinkInfo>>, TError, TData> & {
    queryKey: DataTag<QueryKey, TData, TError>;
};
export type GetMsfwrLinkInfoQueryResult = NonNullable<Awaited<ReturnType<typeof getMsfwrLinkInfo>>>;
export type GetMsfwrLinkInfoQueryError = ErrorType<void>;
export declare function useGetMsfwrLinkInfo<TData = Awaited<ReturnType<typeof getMsfwrLinkInfo>>, TError = ErrorType<void>>(params: GetMsfwrLinkInfoParams, options: {
    query: Partial<UseQueryOptions<Awaited<ReturnType<typeof getMsfwrLinkInfo>>, TError, TData>> & Pick<DefinedInitialDataOptions<Awaited<ReturnType<typeof getMsfwrLinkInfo>>, TError, Awaited<ReturnType<typeof getMsfwrLinkInfo>>>, 'initialData'>;
    request?: SecondParameter<typeof customFetch>;
}, queryClient?: QueryClient): DefinedUseQueryResult<TData, TError> & {
    queryKey: DataTag<QueryKey, TData, TError>;
};
export declare function useGetMsfwrLinkInfo<TData = Awaited<ReturnType<typeof getMsfwrLinkInfo>>, TError = ErrorType<void>>(params: GetMsfwrLinkInfoParams, options?: {
    query?: Partial<UseQueryOptions<Awaited<ReturnType<typeof getMsfwrLinkInfo>>, TError, TData>> & Pick<UndefinedInitialDataOptions<Awaited<ReturnType<typeof getMsfwrLinkInfo>>, TError, Awaited<ReturnType<typeof getMsfwrLinkInfo>>>, 'initialData'>;
    request?: SecondParameter<typeof customFetch>;
}, queryClient?: QueryClient): UseQueryResult<TData, TError> & {
    queryKey: DataTag<QueryKey, TData, TError>;
};
export declare function useGetMsfwrLinkInfo<TData = Awaited<ReturnType<typeof getMsfwrLinkInfo>>, TError = ErrorType<void>>(params: GetMsfwrLinkInfoParams, options?: {
    query?: Partial<UseQueryOptions<Awaited<ReturnType<typeof getMsfwrLinkInfo>>, TError, TData>>;
    request?: SecondParameter<typeof customFetch>;
}, queryClient?: QueryClient): UseQueryResult<TData, TError> & {
    queryKey: DataTag<QueryKey, TData, TError>;
};
export declare const getJoinMsfwrLinkUrl: () => string;
/**
 * Open a session through a shared remote access URL. The viewer gives the link's access code; the PC connects without a prompt.
 */
export declare const joinMsfwrLink: (msfwrLinkJoin: MsfwrLinkJoin, options?: Parameters<typeof customFetch>[1]) => Promise<MsfwrViewer>;
export declare const getJoinMsfwrLinkMutationKey: () => readonly ["joinMsfwrLink"];
export declare const getJoinMsfwrLinkMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof joinMsfwrLink>>, TError, JoinMsfwrLinkMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof joinMsfwrLink>>, TError, JoinMsfwrLinkMutationVariables, TContext>;
export type JoinMsfwrLinkMutationResult = NonNullable<Awaited<ReturnType<typeof joinMsfwrLink>>>;
export type JoinMsfwrLinkMutationBody = BodyType<MsfwrLinkJoin>;
export type JoinMsfwrLinkMutationError = ErrorType<unknown>;
export type JoinMsfwrLinkMutationVariables = {
    data: BodyType<MsfwrLinkJoin>;
};
export declare const useJoinMsfwrLink: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof joinMsfwrLink>>, TError, JoinMsfwrLinkMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}, queryClient?: QueryClient) => UseMutationResult<Awaited<ReturnType<typeof joinMsfwrLink>>, TError, JoinMsfwrLinkMutationVariables, TContext>;
export declare const getGetMsfwrInboxUrl: () => string;
/**
 * For the signed-in company: Initiate requests sent to its RA ID and the PCs whose remote access points to its RA ID.
 */
export declare const getMsfwrInbox: (options?: Parameters<typeof customFetch>[1]) => Promise<MsfwrInbox>;
export declare const getGetMsfwrInboxQueryKey: () => readonly ["/api/msfwr/inbox"];
export declare const getGetMsfwrInboxQueryOptions: <TData = Awaited<ReturnType<typeof getMsfwrInbox>>, TError = ErrorType<unknown>>(options?: {
    query?: Partial<UseQueryOptions<Awaited<ReturnType<typeof getMsfwrInbox>>, TError, TData>>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getMsfwrInbox>>, TError, TData> & {
    queryKey: DataTag<QueryKey, TData, TError>;
};
export type GetMsfwrInboxQueryResult = NonNullable<Awaited<ReturnType<typeof getMsfwrInbox>>>;
export type GetMsfwrInboxQueryError = ErrorType<unknown>;
export declare function useGetMsfwrInbox<TData = Awaited<ReturnType<typeof getMsfwrInbox>>, TError = ErrorType<unknown>>(options: {
    query: Partial<UseQueryOptions<Awaited<ReturnType<typeof getMsfwrInbox>>, TError, TData>> & Pick<DefinedInitialDataOptions<Awaited<ReturnType<typeof getMsfwrInbox>>, TError, Awaited<ReturnType<typeof getMsfwrInbox>>>, 'initialData'>;
    request?: SecondParameter<typeof customFetch>;
}, queryClient?: QueryClient): DefinedUseQueryResult<TData, TError> & {
    queryKey: DataTag<QueryKey, TData, TError>;
};
export declare function useGetMsfwrInbox<TData = Awaited<ReturnType<typeof getMsfwrInbox>>, TError = ErrorType<unknown>>(options?: {
    query?: Partial<UseQueryOptions<Awaited<ReturnType<typeof getMsfwrInbox>>, TError, TData>> & Pick<UndefinedInitialDataOptions<Awaited<ReturnType<typeof getMsfwrInbox>>, TError, Awaited<ReturnType<typeof getMsfwrInbox>>>, 'initialData'>;
    request?: SecondParameter<typeof customFetch>;
}, queryClient?: QueryClient): UseQueryResult<TData, TError> & {
    queryKey: DataTag<QueryKey, TData, TError>;
};
export declare function useGetMsfwrInbox<TData = Awaited<ReturnType<typeof getMsfwrInbox>>, TError = ErrorType<unknown>>(options?: {
    query?: Partial<UseQueryOptions<Awaited<ReturnType<typeof getMsfwrInbox>>, TError, TData>>;
    request?: SecondParameter<typeof customFetch>;
}, queryClient?: QueryClient): UseQueryResult<TData, TError> & {
    queryKey: DataTag<QueryKey, TData, TError>;
};
export declare const getAcceptMsfwrRequestUrl: () => string;
export declare const acceptMsfwrRequest: (msfwrAccept: MsfwrAccept, options?: Parameters<typeof customFetch>[1]) => Promise<MsfwrViewer>;
export declare const getAcceptMsfwrRequestMutationKey: () => readonly ["acceptMsfwrRequest"];
export declare const getAcceptMsfwrRequestMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof acceptMsfwrRequest>>, TError, AcceptMsfwrRequestMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof acceptMsfwrRequest>>, TError, AcceptMsfwrRequestMutationVariables, TContext>;
export type AcceptMsfwrRequestMutationResult = NonNullable<Awaited<ReturnType<typeof acceptMsfwrRequest>>>;
export type AcceptMsfwrRequestMutationBody = BodyType<MsfwrAccept>;
export type AcceptMsfwrRequestMutationError = ErrorType<unknown>;
export type AcceptMsfwrRequestMutationVariables = {
    data: BodyType<MsfwrAccept>;
};
export declare const useAcceptMsfwrRequest: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof acceptMsfwrRequest>>, TError, AcceptMsfwrRequestMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}, queryClient?: QueryClient) => UseMutationResult<Awaited<ReturnType<typeof acceptMsfwrRequest>>, TError, AcceptMsfwrRequestMutationVariables, TContext>;
export declare const getConnectMsfwrPcUrl: () => string;
/**
 * Connect to an online PC whose remote access points to the company's RA ID.
 */
export declare const connectMsfwrPc: (msfwrConnectPc: MsfwrConnectPc, options?: Parameters<typeof customFetch>[1]) => Promise<MsfwrViewer>;
export declare const getConnectMsfwrPcMutationKey: () => readonly ["connectMsfwrPc"];
export declare const getConnectMsfwrPcMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof connectMsfwrPc>>, TError, ConnectMsfwrPcMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof connectMsfwrPc>>, TError, ConnectMsfwrPcMutationVariables, TContext>;
export type ConnectMsfwrPcMutationResult = NonNullable<Awaited<ReturnType<typeof connectMsfwrPc>>>;
export type ConnectMsfwrPcMutationBody = BodyType<MsfwrConnectPc>;
export type ConnectMsfwrPcMutationError = ErrorType<unknown>;
export type ConnectMsfwrPcMutationVariables = {
    data: BodyType<MsfwrConnectPc>;
};
export declare const useConnectMsfwrPc: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof connectMsfwrPc>>, TError, ConnectMsfwrPcMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}, queryClient?: QueryClient) => UseMutationResult<Awaited<ReturnType<typeof connectMsfwrPc>>, TError, ConnectMsfwrPcMutationVariables, TContext>;
export declare const getGetAuthStatusUrl: () => string;
export declare const getAuthStatus: (options?: Parameters<typeof customFetch>[1]) => Promise<AuthStatus>;
export declare const getGetAuthStatusQueryKey: () => readonly ["/api/auth/status"];
export declare const getGetAuthStatusQueryOptions: <TData = Awaited<ReturnType<typeof getAuthStatus>>, TError = ErrorType<unknown>>(options?: {
    query?: Partial<UseQueryOptions<Awaited<ReturnType<typeof getAuthStatus>>, TError, TData>>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getAuthStatus>>, TError, TData> & {
    queryKey: DataTag<QueryKey, TData, TError>;
};
export type GetAuthStatusQueryResult = NonNullable<Awaited<ReturnType<typeof getAuthStatus>>>;
export type GetAuthStatusQueryError = ErrorType<unknown>;
export declare function useGetAuthStatus<TData = Awaited<ReturnType<typeof getAuthStatus>>, TError = ErrorType<unknown>>(options: {
    query: Partial<UseQueryOptions<Awaited<ReturnType<typeof getAuthStatus>>, TError, TData>> & Pick<DefinedInitialDataOptions<Awaited<ReturnType<typeof getAuthStatus>>, TError, Awaited<ReturnType<typeof getAuthStatus>>>, 'initialData'>;
    request?: SecondParameter<typeof customFetch>;
}, queryClient?: QueryClient): DefinedUseQueryResult<TData, TError> & {
    queryKey: DataTag<QueryKey, TData, TError>;
};
export declare function useGetAuthStatus<TData = Awaited<ReturnType<typeof getAuthStatus>>, TError = ErrorType<unknown>>(options?: {
    query?: Partial<UseQueryOptions<Awaited<ReturnType<typeof getAuthStatus>>, TError, TData>> & Pick<UndefinedInitialDataOptions<Awaited<ReturnType<typeof getAuthStatus>>, TError, Awaited<ReturnType<typeof getAuthStatus>>>, 'initialData'>;
    request?: SecondParameter<typeof customFetch>;
}, queryClient?: QueryClient): UseQueryResult<TData, TError> & {
    queryKey: DataTag<QueryKey, TData, TError>;
};
export declare function useGetAuthStatus<TData = Awaited<ReturnType<typeof getAuthStatus>>, TError = ErrorType<unknown>>(options?: {
    query?: Partial<UseQueryOptions<Awaited<ReturnType<typeof getAuthStatus>>, TError, TData>>;
    request?: SecondParameter<typeof customFetch>;
}, queryClient?: QueryClient): UseQueryResult<TData, TError> & {
    queryKey: DataTag<QueryKey, TData, TError>;
};
export declare const getLoginUrl: () => string;
export declare const login: (authLogin: AuthLogin, options?: Parameters<typeof customFetch>[1]) => Promise<Account>;
export declare const getLoginMutationKey: () => readonly ["login"];
export declare const getLoginMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof login>>, TError, LoginMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof login>>, TError, LoginMutationVariables, TContext>;
export type LoginMutationResult = NonNullable<Awaited<ReturnType<typeof login>>>;
export type LoginMutationBody = BodyType<AuthLogin>;
export type LoginMutationError = ErrorType<unknown>;
export type LoginMutationVariables = {
    data: BodyType<AuthLogin>;
};
export declare const useLogin: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof login>>, TError, LoginMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}, queryClient?: QueryClient) => UseMutationResult<Awaited<ReturnType<typeof login>>, TError, LoginMutationVariables, TContext>;
export declare const getLogoutUrl: () => string;
export declare const logout: (options?: Parameters<typeof customFetch>[1]) => Promise<void>;
export declare const getLogoutMutationKey: () => readonly ["logout"];
export declare const getLogoutMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof logout>>, TError, void, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof logout>>, TError, void, TContext>;
export type LogoutMutationResult = NonNullable<Awaited<ReturnType<typeof logout>>>;
export type LogoutMutationError = ErrorType<unknown>;
export declare const useLogout: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof logout>>, TError, void, TContext>;
    request?: SecondParameter<typeof customFetch>;
}, queryClient?: QueryClient) => UseMutationResult<Awaited<ReturnType<typeof logout>>, TError, void, TContext>;
export declare const getChangePasswordUrl: () => string;
export declare const changePassword: (passwordChange: PasswordChange, options?: Parameters<typeof customFetch>[1]) => Promise<void>;
export declare const getChangePasswordMutationKey: () => readonly ["changePassword"];
export declare const getChangePasswordMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof changePassword>>, TError, ChangePasswordMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof changePassword>>, TError, ChangePasswordMutationVariables, TContext>;
export type ChangePasswordMutationResult = NonNullable<Awaited<ReturnType<typeof changePassword>>>;
export type ChangePasswordMutationBody = BodyType<PasswordChange>;
export type ChangePasswordMutationError = ErrorType<unknown>;
export type ChangePasswordMutationVariables = {
    data: BodyType<PasswordChange>;
};
export declare const useChangePassword: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof changePassword>>, TError, ChangePasswordMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}, queryClient?: QueryClient) => UseMutationResult<Awaited<ReturnType<typeof changePassword>>, TError, ChangePasswordMutationVariables, TContext>;
export declare const getListUsersUrl: () => string;
export declare const listUsers: (options?: Parameters<typeof customFetch>[1]) => Promise<AccountList>;
export declare const getListUsersQueryKey: () => readonly ["/api/admin/users"];
export declare const getListUsersQueryOptions: <TData = Awaited<ReturnType<typeof listUsers>>, TError = ErrorType<unknown>>(options?: {
    query?: Partial<UseQueryOptions<Awaited<ReturnType<typeof listUsers>>, TError, TData>>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listUsers>>, TError, TData> & {
    queryKey: DataTag<QueryKey, TData, TError>;
};
export type ListUsersQueryResult = NonNullable<Awaited<ReturnType<typeof listUsers>>>;
export type ListUsersQueryError = ErrorType<unknown>;
export declare function useListUsers<TData = Awaited<ReturnType<typeof listUsers>>, TError = ErrorType<unknown>>(options: {
    query: Partial<UseQueryOptions<Awaited<ReturnType<typeof listUsers>>, TError, TData>> & Pick<DefinedInitialDataOptions<Awaited<ReturnType<typeof listUsers>>, TError, Awaited<ReturnType<typeof listUsers>>>, 'initialData'>;
    request?: SecondParameter<typeof customFetch>;
}, queryClient?: QueryClient): DefinedUseQueryResult<TData, TError> & {
    queryKey: DataTag<QueryKey, TData, TError>;
};
export declare function useListUsers<TData = Awaited<ReturnType<typeof listUsers>>, TError = ErrorType<unknown>>(options?: {
    query?: Partial<UseQueryOptions<Awaited<ReturnType<typeof listUsers>>, TError, TData>> & Pick<UndefinedInitialDataOptions<Awaited<ReturnType<typeof listUsers>>, TError, Awaited<ReturnType<typeof listUsers>>>, 'initialData'>;
    request?: SecondParameter<typeof customFetch>;
}, queryClient?: QueryClient): UseQueryResult<TData, TError> & {
    queryKey: DataTag<QueryKey, TData, TError>;
};
export declare function useListUsers<TData = Awaited<ReturnType<typeof listUsers>>, TError = ErrorType<unknown>>(options?: {
    query?: Partial<UseQueryOptions<Awaited<ReturnType<typeof listUsers>>, TError, TData>>;
    request?: SecondParameter<typeof customFetch>;
}, queryClient?: QueryClient): UseQueryResult<TData, TError> & {
    queryKey: DataTag<QueryKey, TData, TError>;
};
export declare const getCreateUserUrl: () => string;
export declare const createUser: (accountCreate: AccountCreate, options?: Parameters<typeof customFetch>[1]) => Promise<Account>;
export declare const getCreateUserMutationKey: () => readonly ["createUser"];
export declare const getCreateUserMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createUser>>, TError, CreateUserMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof createUser>>, TError, CreateUserMutationVariables, TContext>;
export type CreateUserMutationResult = NonNullable<Awaited<ReturnType<typeof createUser>>>;
export type CreateUserMutationBody = BodyType<AccountCreate>;
export type CreateUserMutationError = ErrorType<unknown>;
export type CreateUserMutationVariables = {
    data: BodyType<AccountCreate>;
};
export declare const useCreateUser: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createUser>>, TError, CreateUserMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}, queryClient?: QueryClient) => UseMutationResult<Awaited<ReturnType<typeof createUser>>, TError, CreateUserMutationVariables, TContext>;
export declare const getUpdateUserUrl: (id: string) => string;
export declare const updateUser: (id: string, accountUpdate: AccountUpdate, options?: Parameters<typeof customFetch>[1]) => Promise<Account>;
export declare const getUpdateUserMutationKey: () => readonly ["updateUser"];
export declare const getUpdateUserMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateUser>>, TError, UpdateUserMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof updateUser>>, TError, UpdateUserMutationVariables, TContext>;
export type UpdateUserMutationResult = NonNullable<Awaited<ReturnType<typeof updateUser>>>;
export type UpdateUserMutationBody = BodyType<AccountUpdate>;
export type UpdateUserMutationError = ErrorType<unknown>;
export type UpdateUserMutationVariables = {
    id: string;
    data: BodyType<AccountUpdate>;
};
export declare const useUpdateUser: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateUser>>, TError, UpdateUserMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}, queryClient?: QueryClient) => UseMutationResult<Awaited<ReturnType<typeof updateUser>>, TError, UpdateUserMutationVariables, TContext>;
export declare const getDeleteUserUrl: (id: string) => string;
export declare const deleteUser: (id: string, options?: Parameters<typeof customFetch>[1]) => Promise<void>;
export declare const getDeleteUserMutationKey: () => readonly ["deleteUser"];
export declare const getDeleteUserMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteUser>>, TError, DeleteUserMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof deleteUser>>, TError, DeleteUserMutationVariables, TContext>;
export type DeleteUserMutationResult = NonNullable<Awaited<ReturnType<typeof deleteUser>>>;
export type DeleteUserMutationError = ErrorType<unknown>;
export type DeleteUserMutationVariables = {
    id: string;
};
export declare const useDeleteUser: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteUser>>, TError, DeleteUserMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}, queryClient?: QueryClient) => UseMutationResult<Awaited<ReturnType<typeof deleteUser>>, TError, DeleteUserMutationVariables, TContext>;
export declare const getGetAdminOverviewUrl: () => string;
export declare const getAdminOverview: (options?: Parameters<typeof customFetch>[1]) => Promise<AdminOverview>;
export declare const getGetAdminOverviewQueryKey: () => readonly ["/api/admin/overview"];
export declare const getGetAdminOverviewQueryOptions: <TData = Awaited<ReturnType<typeof getAdminOverview>>, TError = ErrorType<unknown>>(options?: {
    query?: Partial<UseQueryOptions<Awaited<ReturnType<typeof getAdminOverview>>, TError, TData>>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getAdminOverview>>, TError, TData> & {
    queryKey: DataTag<QueryKey, TData, TError>;
};
export type GetAdminOverviewQueryResult = NonNullable<Awaited<ReturnType<typeof getAdminOverview>>>;
export type GetAdminOverviewQueryError = ErrorType<unknown>;
export declare function useGetAdminOverview<TData = Awaited<ReturnType<typeof getAdminOverview>>, TError = ErrorType<unknown>>(options: {
    query: Partial<UseQueryOptions<Awaited<ReturnType<typeof getAdminOverview>>, TError, TData>> & Pick<DefinedInitialDataOptions<Awaited<ReturnType<typeof getAdminOverview>>, TError, Awaited<ReturnType<typeof getAdminOverview>>>, 'initialData'>;
    request?: SecondParameter<typeof customFetch>;
}, queryClient?: QueryClient): DefinedUseQueryResult<TData, TError> & {
    queryKey: DataTag<QueryKey, TData, TError>;
};
export declare function useGetAdminOverview<TData = Awaited<ReturnType<typeof getAdminOverview>>, TError = ErrorType<unknown>>(options?: {
    query?: Partial<UseQueryOptions<Awaited<ReturnType<typeof getAdminOverview>>, TError, TData>> & Pick<UndefinedInitialDataOptions<Awaited<ReturnType<typeof getAdminOverview>>, TError, Awaited<ReturnType<typeof getAdminOverview>>>, 'initialData'>;
    request?: SecondParameter<typeof customFetch>;
}, queryClient?: QueryClient): UseQueryResult<TData, TError> & {
    queryKey: DataTag<QueryKey, TData, TError>;
};
export declare function useGetAdminOverview<TData = Awaited<ReturnType<typeof getAdminOverview>>, TError = ErrorType<unknown>>(options?: {
    query?: Partial<UseQueryOptions<Awaited<ReturnType<typeof getAdminOverview>>, TError, TData>>;
    request?: SecondParameter<typeof customFetch>;
}, queryClient?: QueryClient): UseQueryResult<TData, TError> & {
    queryKey: DataTag<QueryKey, TData, TError>;
};
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