import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { UserRow } from '../auth/auth.types.js';
import { CommentsService } from './comments.service.js';
import { CommentReactionDto, CreateCommentDto, CreatePostDto, PostListQueryDto, ReactDto } from './posts.dto.js';
import { PostsService } from './posts.service.js';

@Controller('v1')
@UseGuards(AuthGuard)
export class PostsController {
  constructor(
    private readonly posts: PostsService,
    private readonly comments: CommentsService,
  ) {}

  @Get('feed')
  feed(@CurrentUser() user: UserRow, @Query() query: PostListQueryDto) {
    return this.posts.feed(user.id, query);
  }

  @Post('posts')
  @HttpCode(201)
  create(@CurrentUser() user: UserRow, @Body() dto: CreatePostDto) {
    return this.posts.create(user.id, dto);
  }

  @Get('posts/:id')
  get(@CurrentUser() user: UserRow, @Param('id') id: string) {
    return this.posts.get(user.id, id);
  }

  @Delete('posts/:id')
  @HttpCode(200)
  remove(@CurrentUser() user: UserRow, @Param('id') id: string) {
    return this.posts.remove(user.id, id);
  }

  @Post('posts/:id/reactions')
  @HttpCode(200)
  react(@CurrentUser() user: UserRow, @Param('id') id: string, @Body() dto: ReactDto) {
    return this.posts.react(user.id, id, dto);
  }

  @Delete('posts/:id/reactions')
  @HttpCode(200)
  unreact(@CurrentUser() user: UserRow, @Param('id') id: string) {
    return this.posts.unreact(user.id, id);
  }

  @Post('posts/:id/save')
  @HttpCode(200)
  save(@CurrentUser() user: UserRow, @Param('id') id: string) {
    return this.posts.save(user.id, id);
  }

  @Delete('posts/:id/save')
  @HttpCode(200)
  unsave(@CurrentUser() user: UserRow, @Param('id') id: string) {
    return this.posts.unsave(user.id, id);
  }

  @Get('posts/:id/comments')
  listComments(@CurrentUser() user: UserRow, @Param('id') id: string, @Query() query: PostListQueryDto) {
    return this.comments.list(user.id, id, query);
  }

  @Post('posts/:id/comments')
  @HttpCode(201)
  comment(@CurrentUser() user: UserRow, @Param('id') id: string, @Body() dto: CreateCommentDto) {
    return this.comments.create(user.id, id, dto);
  }

  @Delete('comments/:id')
  @HttpCode(200)
  removeComment(@CurrentUser() user: UserRow, @Param('id') id: string) {
    return this.comments.remove(user.id, id);
  }

  @Post('comments/:id/reactions')
  @HttpCode(200)
  reactComment(@CurrentUser() user: UserRow, @Param('id') id: string, @Body() dto: CommentReactionDto) {
    return this.comments.react(user.id, id, dto);
  }

  @Delete('comments/:id/reactions')
  @HttpCode(200)
  unreactComment(@CurrentUser() user: UserRow, @Param('id') id: string) {
    return this.comments.unreact(user.id, id);
  }

  @Get('users/:id/posts')
  authorPosts(@CurrentUser() user: UserRow, @Param('id') id: string, @Query() query: PostListQueryDto) {
    return this.posts.authorPosts(user.id, id, query);
  }

  @Get('hashtags/:tag/posts')
  tagged(@CurrentUser() user: UserRow, @Param('tag') tag: string, @Query() query: PostListQueryDto) {
    return this.posts.tagged(user.id, tag, query);
  }

  @Get('me/saves')
  saves(@CurrentUser() user: UserRow, @Query() query: PostListQueryDto) {
    return this.posts.saved(user.id, query);
  }
}
