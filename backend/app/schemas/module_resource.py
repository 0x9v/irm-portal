"""Public and create-time schemas for typed module resources."""

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator, model_validator

from app.models.document import DocumentSource, DocumentStatus, DocumentType, ResourceKind
from app.models.document_vote import VoteValue


ResourceTitle = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)]
ResourceDescription = Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)]


class ResourceCreateUrlBase(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: ResourceTitle
    description: ResourceDescription | None = None
    source: DocumentSource | None = None
    type: DocumentType | None = None
    url: str

    @field_validator("description", mode="before")
    @classmethod
    def normalize_empty_description(cls, value):
        if isinstance(value, str) and not value.strip():
            return None
        return value


class YoutubeResourceCreate(ResourceCreateUrlBase):
    kind: Literal[ResourceKind.YOUTUBE]


class LinkResourceCreate(ResourceCreateUrlBase):
    kind: Literal[ResourceKind.LINK]


class ResourceFileMetadata(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: ResourceKind
    title: ResourceTitle
    description: ResourceDescription | None = None
    source: DocumentSource | None = None
    type: DocumentType | None = None

    @field_validator("description", mode="before")
    @classmethod
    def normalize_file_description(cls, value):
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @model_validator(mode="after")
    def validate_type_for_kind(self):
        if self.kind == ResourceKind.PDF and self.type is None:
            raise ValueError("PDF type is required")
        if self.kind not in (ResourceKind.PDF, ResourceKind.IMAGE):
            raise ValueError("File upload only supports PDF or IMAGE resources")
        return self


class ResourceBaseResponse(BaseModel):
    id: UUID
    module_id: UUID
    kind: ResourceKind
    category: DocumentType | None
    title: str
    description: str | None
    source: DocumentSource
    status: DocumentStatus
    created_at: datetime
    updated_at: datetime


class PdfResourceResponse(ResourceBaseResponse):
    kind: Literal[ResourceKind.PDF]
    document_type: DocumentType


class ImageResourceResponse(ResourceBaseResponse):
    kind: Literal[ResourceKind.IMAGE]
    preview_url: str


class YoutubeResourceResponse(ResourceBaseResponse):
    kind: Literal[ResourceKind.YOUTUBE]
    video_id: str
    url: str


class LinkResourceResponse(ResourceBaseResponse):
    kind: Literal[ResourceKind.LINK]
    url: str


ResourceResponse = Annotated[
    PdfResourceResponse | ImageResourceResponse | YoutubeResourceResponse | LinkResourceResponse,
    Field(discriminator="kind"),
]


class ModuleResourceFeedResponse(BaseModel):
    items: list[ResourceResponse]
    next_cursor: UUID | None = None


class FileResourcePreview(BaseModel):
    url: str
    media_type: Literal["image/png", "image/webp"]


class OutboundResourcePreview(BaseModel):
    url: str


class PendingResourceState(BaseModel):
    module_slug: str
    module_name: str
    is_uploader: bool
    my_vote: VoteValue | None
    can_vote: bool
    can_approve: bool
    can_delete: bool
    full_resource_access: bool


class PendingPdfResourceResponse(PdfResourceResponse, PendingResourceState):
    preview: FileResourcePreview


class PendingImageResourceResponse(ImageResourceResponse, PendingResourceState):
    preview: FileResourcePreview


class PendingYoutubeResourceResponse(YoutubeResourceResponse, PendingResourceState):
    preview: OutboundResourcePreview


class PendingLinkResourceResponse(LinkResourceResponse, PendingResourceState):
    preview: OutboundResourcePreview


PendingResourceResponse = Annotated[
    PendingPdfResourceResponse | PendingImageResourceResponse
    | PendingYoutubeResourceResponse | PendingLinkResourceResponse,
    Field(discriminator="kind"),
]


class PendingResourceFeedResponse(BaseModel):
    items: list[PendingResourceResponse]
    next_cursor: UUID | None = None


class MyResourceState(BaseModel):
    module_slug: str
    module_name: str
    can_delete: bool


class MyPdfResourceResponse(PdfResourceResponse, MyResourceState):
    pass


class MyImageResourceResponse(ImageResourceResponse, MyResourceState):
    pass


class MyYoutubeResourceResponse(YoutubeResourceResponse, MyResourceState):
    pass


class MyLinkResourceResponse(LinkResourceResponse, MyResourceState):
    pass


MyResourceResponse = Annotated[
    MyPdfResourceResponse | MyImageResourceResponse
    | MyYoutubeResourceResponse | MyLinkResourceResponse,
    Field(discriminator="kind"),
]


class MyResourceFeedResponse(BaseModel):
    items: list[MyResourceResponse]
    next_cursor: UUID | None = None


class ResourceVoteResponse(BaseModel):
    vote: VoteValue
    full_resource_access: bool


class ResourceApprovalResponse(BaseModel):
    id: UUID
    status: Literal[DocumentStatus.APPROVED]
