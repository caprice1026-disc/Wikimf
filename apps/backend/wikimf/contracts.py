from datetime import datetime, timezone
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt, field_validator, model_validator

Int = Annotated[StrictInt, Field(ge=0)]
PositiveInt = Annotated[StrictInt, Field(gt=0, le=2147483647)]
Wiki = Literal["jawiki", "enwiki"]
Source = Literal["android_reader", "chrome_extension"]
State = Literal["viewed", "partial", "completed"]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Interval(StrictModel):
    start_at: datetime
    end_at: datetime
    active_spans_ms: list[tuple[Int, Int]] = Field(max_length=1000)

    @field_validator("start_at", "end_at", mode="before")
    @classmethod
    def timestamp_strings(cls, value):
        if not isinstance(value, str):
            raise ValueError("timestamp must be a date-time string")
        return value

    @model_validator(mode="after")
    def validate_interval(self):
        for value in (self.start_at, self.end_at):
            if value.tzinfo is None or value.utcoffset().total_seconds() != 0:
                raise ValueError("timestamps must be UTC")
        length = round((self.end_at - self.start_at).total_seconds() * 1000)
        if length < 0 or length > 60000:
            raise ValueError("interval must be between zero and 60 seconds")
        end = 0
        for a, b in self.active_spans_ms:
            if a < end or b <= a or b > length:
                raise ValueError("active spans must be ascending, disjoint and within interval")
            end = b
        return self


class Document(StrictModel):
    fingerprint: str | None = Field(pattern=r"^[a-f0-9]{64}$", default=None)
    extractor_version: Literal["prose-v1"]
    observed_revision_id: PositiveInt | None = None
    text_chars: Annotated[StrictInt, Field(ge=0, le=1000000)] | None
    chunk_chars: list[Annotated[StrictInt, Field(gt=0, le=200)]] = Field(max_length=5000)


class Progress(StrictModel):
    active_ms_total: Int
    covered_chunk_ids: list[Int] = Field(max_length=5000)
    measurement_status: Literal["ok", "time_only"]
    max_scroll_ratio: float = Field(ge=0, le=1, default=0, strict=True)
    reason_code: str | None = Field(default=None, max_length=60)


class ReadingEventInput(StrictModel):
    schema_version: Literal[1] = 1
    event_id: UUID
    type: Literal["session.opened", "reading.observed", "session.closed"]
    device_id: UUID
    session_id: UUID
    session_started_at: datetime
    seq: Annotated[StrictInt, Field(ge=0, le=2147483647)]
    source: Source
    article_id: UUID
    wiki: Wiki
    page_id: PositiveInt
    recording_epoch: PositiveInt
    occurred_at: datetime
    interval: Interval
    document: Document
    progress: Progress
    client_version: str = Field(min_length=1, max_length=40)
    measurement_policy_version: Literal["reading-v1"]
    reason: Literal["navigate", "reload", "pause", "logout", "document_changed", "clock_changed", "process_lost", "extractor_changed"] | None = None

    @field_validator("schema_version", mode="before")
    @classmethod
    def integer_version(cls, value):
        if type(value) is not int:
            raise ValueError("schema_version must be integer 1")
        return value

    @field_validator("session_started_at", "occurred_at", mode="before")
    @classmethod
    def timestamp_strings(cls, value):
        if not isinstance(value, str):
            raise ValueError("timestamp must be a date-time string")
        return value

    @model_validator(mode="after")
    def consistency(self):
        for stamp in (self.session_started_at, self.occurred_at):
            if stamp.tzinfo is None or stamp.utcoffset().total_seconds() != 0:
                raise ValueError("timestamps must be UTC")
        if not self.session_started_at <= self.interval.start_at <= self.interval.end_at <= self.occurred_at:
            raise ValueError("event interval chronology invalid")
        if self.type == "session.opened":
            if self.seq != 0 or self.interval.start_at != self.interval.end_at or self.progress.active_ms_total or self.interval.active_spans_ms or self.progress.covered_chunk_ids:
                raise ValueError("opened must be a zero observation at seq 0")
        elif self.seq == 0:
            raise ValueError("observed/closed seq must be positive")
        if self.type == "reading.observed" and self.interval.start_at == self.interval.end_at:
            raise ValueError("observed interval must be positive")
        if self.type == "session.closed" and self.reason is None:
            raise ValueError("closed reason required")
        if self.type != "session.closed" and self.reason is not None:
            raise ValueError("reason only applies to closed")
        p, d = self.progress, self.document
        if len(set(p.covered_chunk_ids)) != len(p.covered_chunk_ids):
            raise ValueError("duplicate covered chunks")
        if p.measurement_status == "time_only":
            if d.fingerprint is not None or d.text_chars is not None or d.chunk_chars or p.covered_chunk_ids or not p.reason_code:
                raise ValueError("time_only must have empty document and reason_code")
        else:
            if not d.fingerprint or not d.text_chars or sum(d.chunk_chars) != d.text_chars or p.reason_code:
                raise ValueError("invalid measured document")
            if any(i >= len(d.chunk_chars) for i in p.covered_chunk_ids):
                raise ValueError("covered chunk outside document")
        if sum(b-a for a,b in self.interval.active_spans_ms) > p.active_ms_total:
            raise ValueError("interval active exceeds cumulative snapshot")
        return self


class EventBatch(StrictModel):
    schema_version: Literal[1]
    events: list[dict] = Field(min_length=1, max_length=100)

    @field_validator("schema_version", mode="before")
    @classmethod
    def integer_version(cls, value):
        if type(value) is not int:
            raise ValueError("schema_version must be integer 1")
        return value


class ResolveInput(StrictModel):
    url: str | None = Field(default=None, max_length=2000)
    wiki: Wiki | None = None
    page_id: PositiveInt | None = None

    @model_validator(mode="after")
    def one_identifier(self):
        if bool(self.url) == bool(self.wiki and self.page_id) or (self.url and (self.wiki or self.page_id)):
            raise ValueError("provide url or wiki and page_id")
        return self


class PairInput(StrictModel):
    source: Source
    display_name: str = Field(min_length=1, max_length=100)


class PairExchange(StrictModel):
    device_secret: str = Field(min_length=32, max_length=128)


class PairApproval(StrictModel):
    user_code: str = Field(min_length=6, max_length=16)


class StateInput(StrictModel):
    state: State


class PrivacyInput(StrictModel):
    collection_enabled: StrictBool | None = None
    consent_version: Literal["privacy-v1"] | None = None
    profile_public: StrictBool | None = None
    publish_total_time: StrictBool | None = None
    publish_achievements: StrictBool | None = None
    timezone: str | None = Field(default=None, max_length=64)
    display_name: str | None = Field(default=None, min_length=1, max_length=100)


class BatchGet(StrictModel):
    article_ids: list[UUID] = Field(min_length=1, max_length=100)


class DeleteAccount(StrictModel):
    confirmation: Literal["DELETE"]
