export interface PostModuleTag {
  id: string;
  slug: string;
  name: string;
}

export interface CommunityPostFeedItem {
  id: string;
  title: string;
  excerpt: string;
  author_username: string;
  created_at: string;
  modules: PostModuleTag[];
}

export interface CommunityPostFeedResponse {
  items: CommunityPostFeedItem[];
  next_cursor: string | null;
}

export interface CommunityPostDetail {
  id: string;
  title: string;
  content: string;
  author_username: string;
  created_at: string;
  modules: PostModuleTag[];
}

export interface CommunityPostReply {
  id: string;
  post_id: string;
  author_username: string;
  content: string;
  created_at: string;
  image_url?: string | null;
}

export interface CommunityPostReplyListResponse {
  items: CommunityPostReply[];
  next_cursor: string | null;
}
