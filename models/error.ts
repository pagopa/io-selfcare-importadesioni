// eslint-disable-next-line max-classes-per-file
import { INonEmptyStringTag } from "@pagopa/ts-commons/lib/strings";

// eslint-disable-next-line max-classes-per-file
export class ValidationError extends Error {}
export class FetchMembershipError extends Error {}
export class FiscalCodeNotFoundError extends Error {}
export class UpsertError extends Error {}
export class FetchPecDelegatesError extends Error {}
export class FetchPecAttachmentError extends Error {}
export class FetchPecSoggettoAggregatoError extends Error {}
export class FetchPecEmailError extends Error {}
export class SaveContractError extends Error {}
export class NotImplementedError extends Error {}
export class ProcessedMembershipError extends Error {
  public readonly ipaCode: string & INonEmptyStringTag;
  constructor(ipaCode: string & INonEmptyStringTag, message: string) {
    super(message);
    this.ipaCode = ipaCode;
  }
}
